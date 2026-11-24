// Logic tests for Account/Contact handling against an in-memory fake CRM.
// These do NOT prove the live Zoho integration works; see ZOHO_INTEGRATION.md §8.

import { test } from "node:test";
import assert from "node:assert/strict";
import { processEnquiry, resolveAccount, ZohoError, createZohoClient, escapeCriteria } from "../zoho-crm.mjs";
import { validateEnquiry, splitName } from "../validate.mjs";

const cfg = { servicesField: "Services_Interested_In", consentField: "Marketing_Consent", leadSource: "", addNote: true };

function fakeZoho() {
  const db = { accounts: [], contacts: [], notes: [] };
  let seq = 0;
  const id = () => String(++seq);
  const t = () => new Date(2026, 0, 1, 0, 0, seq).toISOString();
  return {
    db,
    async findContactByEmail(email) { return db.contacts.find((c) => c.Email === email) || null; },
    async findAccountsByName(name) { return db.accounts.filter((a) => a.Account_Name.toLowerCase() === name.toLowerCase()); },
    async createAccount(r) { const rec = { id: id(), Created_Time: t(), ...r }; db.accounts.push(rec); return rec.id; },
    async createContact(r) {
      const acc = db.accounts.find((a) => a.id === r.Account_Name.id);
      const rec = { id: id(), Created_Time: t(), ...r, Account_Name: { id: acc.id, name: acc.Account_Name } };
      db.contacts.push(rec); return rec.id;
    },
    async updateContact(cid, r) {
      const c = db.contacts.find((x) => x.id === cid);
      Object.assign(c, r);
      if (r.Account_Name) { const acc = db.accounts.find((a) => a.id === r.Account_Name.id); c.Account_Name = { id: acc.id, name: acc.Account_Name }; }
      return cid;
    },
    async addContactNote(cid, title, content) { db.notes.push({ cid, title, content }); return id(); },
  };
}

const priya = {
  fullName: "Priya Sharma", email: "priya@example.com", phone: "+44 7700 900123",
  company: "Thames & Co Accountants", country: "United Kingdom",
  services: ["Accounting Services", "Bookkeeping Services", "Tax Services"], marketingConsent: false,
};

test("new company + new person: creates one Account and one linked Contact", async () => {
  const z = fakeZoho();
  const out = await processEnquiry(z, cfg, priya);
  assert.equal(z.db.accounts.length, 1);
  assert.equal(z.db.contacts.length, 1);
  const c = z.db.contacts[0];
  assert.equal(c.First_Name, "Priya");
  assert.equal(c.Last_Name, "Sharma");
  assert.equal(c.Account_Name.id, z.db.accounts[0].id);
  assert.deepEqual(c.Services_Interested_In, priya.services);
  assert.equal("Marketing_Consent" in c, false);
  assert.ok(out.contactCreated && out.accountCreated);
  assert.equal(z.db.notes.length, 1);
});

test("existing Account (different case): reused, no duplicate Account", async () => {
  const z = fakeZoho();
  await z.createAccount({ Account_Name: "THAMES & CO ACCOUNTANTS" });
  await processEnquiry(z, cfg, priya);
  assert.equal(z.db.accounts.length, 1);
  assert.equal(z.db.contacts[0].Account_Name.id, z.db.accounts[0].id);
});

test("second person at same company: both Contacts share one Account", async () => {
  const z = fakeZoho();
  await processEnquiry(z, cfg, priya);
  await processEnquiry(z, cfg, { ...priya, fullName: "Tom Ellis", email: "tom@example.com" });
  assert.equal(z.db.accounts.length, 1);
  assert.equal(z.db.contacts.length, 2);
  assert.equal(z.db.contacts[0].Account_Name.id, z.db.contacts[1].Account_Name.id);
});

test("existing Contact by email: updated not duplicated, services merged, Account link kept", async () => {
  const z = fakeZoho();
  await processEnquiry(z, cfg, priya);
  const out = await processEnquiry(z, cfg, { ...priya, company: "Other Ltd", services: ["Payroll Services", "Tax Services"], marketingConsent: true });
  assert.equal(z.db.contacts.length, 1);
  assert.equal(z.db.accounts.length, 1, "no Account created for the new company name");
  const c = z.db.contacts[0];
  assert.deepEqual(c.Services_Interested_In, ["Accounting Services", "Bookkeeping Services", "Tax Services", "Payroll Services"]);
  assert.equal(c.Account_Name.name, "Thames & Co Accountants");
  assert.equal(c.Marketing_Consent, true);
  assert.equal(out.contactCreated, false);
  assert.match(out.notes[0], /Link left unchanged/);
});

test("existing Contact with no Account: gets linked", async () => {
  const z = fakeZoho();
  z.db.contacts.push({ id: "c1", Email: priya.email, Last_Name: "Sharma" });
  await processEnquiry(z, cfg, priya);
  assert.equal(z.db.contacts[0].Account_Name.name, "Thames & Co Accountants");
});

test("Account create race (DUPLICATE_DATA): uses the existing record", async () => {
  const z = fakeZoho();
  z.findAccountsByName = async () => [];
  z.createAccount = async () => { throw new ZohoError("dup", { code: "DUPLICATE_DATA", details: { duplicate_record: { id: "acc-9" } } }); };
  const acc = await resolveAccount(z, "Thames & Co Accountants", "United Kingdom");
  assert.deepEqual(acc, { id: "acc-9", created: false, ambiguous: false });
});

test("CRM errors propagate (so the site shows an error, never a fake success)", async () => {
  const z = fakeZoho();
  z.createContact = async () => { throw new ZohoError("bad", { code: "INVALID_DATA" }); };
  await assert.rejects(processEnquiry(z, cfg, priya), /bad/);
});

test("validation: rejects unknown services and bad email; accepts the demo record", () => {
  assert.equal(validateEnquiry({ ...priya }).ok, true);
  const bad = validateEnquiry({ ...priya, email: "nope", services: ["Hacking"] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.email && bad.errors.services);
  assert.deepEqual(splitName("Cher"), { First_Name: "", Last_Name: "Cher" });
});

test("HTTP client: refreshes token, sends auth header, treats 204 as no results, escapes criteria", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/oauth/v2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    return new Response(null, { status: 204 });
  };
  const client = createZohoClient({
    accountsUrl: "https://accounts.zoho.eu", apiDomain: "https://www.zohoapis.eu", apiVersion: "v8",
    clientId: "id", clientSecret: "s", refreshToken: "r", triggers: [],
  }, fetchStub);
  const rows = await client.findAccountsByName("Smith, Jones (UK)");
  assert.deepEqual(rows, []);
  const search = new URL(calls[1].url);
  assert.equal(search.pathname, "/crm/v8/Accounts/search");
  assert.equal(search.searchParams.get("criteria"), "(Account_Name:equals:Smith\\, Jones \\(UK\\))");
  assert.equal(calls[1].init.headers.Authorization, "Zoho-oauthtoken tok");
  assert.equal(escapeCriteria("a\\b"), "a\\\\b");
});
