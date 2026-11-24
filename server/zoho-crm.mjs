// Zoho CRM client + enquiry processing (Accounts / Contacts only — no Leads, no Deals).
//
// Credentials are read from environment variables on the server and never
// reach the browser. See ZOHO_INTEGRATION.md for the field set-up and OAuth steps.

import { splitName } from "./validate.mjs";

export function loadConfig(env = process.env) {
  const cfg = {
    accountsUrl: (env.ZOHO_ACCOUNTS_URL || "").replace(/\/$/, ""),
    apiDomain: (env.ZOHO_API_DOMAIN || "").replace(/\/$/, ""),
    apiVersion: env.ZOHO_API_VERSION || "v8",
    clientId: env.ZOHO_CLIENT_ID || "",
    clientSecret: env.ZOHO_CLIENT_SECRET || "",
    refreshToken: env.ZOHO_REFRESH_TOKEN || "",
    servicesField: env.ZOHO_SERVICES_FIELD || "Services_Interested_In",
    consentField: env.ZOHO_CONSENT_FIELD ?? "Marketing_Consent",
    leadSource: env.ZOHO_LEAD_SOURCE || "",
    triggers: (env.ZOHO_TRIGGERS ?? "workflow").split(",").map((s) => s.trim()).filter(Boolean),
    assignmentRuleId: env.ZOHO_CONTACT_ASSIGNMENT_RULE_ID || "",
    addNote: (env.ZOHO_ADD_NOTE ?? "true") === "true",
  };
  cfg.missing = ["accountsUrl", "apiDomain", "clientId", "clientSecret", "refreshToken"].filter((k) => !cfg[k]);
  return cfg;
}

export class ZohoError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "ZohoError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Escape a value for Zoho's search `criteria` syntax: ( ) , and \ must be backslash-escaped. */
export const escapeCriteria = (v) => v.replace(/[\\(),]/g, (c) => `\\${c}`);

export function createZohoClient(cfg, fetchImpl = globalThis.fetch) {
  let token = null;
  let tokenExpiresAt = 0;

  async function getAccessToken(force = false) {
    if (!force && token && Date.now() < tokenExpiresAt) return token;
    const params = new URLSearchParams({
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    });
    const res = await fetchImpl(`${cfg.accountsUrl}/oauth/v2/token`, { method: "POST", body: params });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new ZohoError("Could not obtain Zoho access token", { status: res.status, code: data.error });
    }
    token = data.access_token;
    tokenExpiresAt = Date.now() + Math.max((Number(data.expires_in) || 3600) - 120, 60) * 1000;
    return token;
  }

  async function request(method, path, { query, body } = {}, retried = false) {
    const url = new URL(`${cfg.apiDomain}/crm/${cfg.apiVersion}${path}`);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${await getAccessToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      await getAccessToken(true);
      return request(method, path, { query, body }, true);
    }
    if (res.status === 204) return { status: 204, data: null }; // e.g. search with no results
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  /** Unwrap a single-record write response; throws unless code === SUCCESS. */
  function writeResult({ status, data }, what) {
    const row = data?.data?.[0];
    if (row?.code === "SUCCESS") return row.details.id;
    throw new ZohoError(`${what} failed`, {
      status,
      code: row?.code || data?.code,
      details: row?.details || data?.details,
    });
  }

  async function search(module, query) {
    const { status, data } = await request("GET", `/${module}/search`, { query });
    if (status === 204) return [];
    if (status >= 400) throw new ZohoError(`${module} search failed`, { status, code: data?.code, details: data?.details });
    return data?.data || [];
  }

  const writeOptions = () => ({
    ...(cfg.triggers.length ? { trigger: cfg.triggers } : { trigger: [] }),
  });

  return {
    getAccessToken,
    request,

    async findContactByEmail(email) {
      const rows = await search("Contacts", { email });
      // Exact match only; oldest first so behaviour is deterministic if duplicates already exist.
      return rows
        .filter((r) => (r.Email || "").toLowerCase() === email)
        .sort((a, b) => String(a.Created_Time).localeCompare(String(b.Created_Time)))[0] || null;
    },

    async findAccountsByName(name) {
      const rows = await search("Accounts", { criteria: `(Account_Name:equals:${escapeCriteria(name)})` });
      const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
      return rows
        .filter((r) => norm(r.Account_Name) === norm(name))
        .sort((a, b) => String(a.Created_Time).localeCompare(String(b.Created_Time)));
    },

    async createAccount(record) {
      const res = await request("POST", "/Accounts", { body: { data: [record], ...writeOptions() } });
      return writeResult(res, "Account create");
    },

    async createContact(record) {
      const body = { data: [record], ...writeOptions() };
      if (cfg.assignmentRuleId) body.lar_id = cfg.assignmentRuleId;
      const res = await request("POST", "/Contacts", { body });
      return writeResult(res, "Contact create");
    },

    async updateContact(id, record) {
      const res = await request("PUT", "/Contacts", { body: { data: [{ id, ...record }], ...writeOptions() } });
      return writeResult(res, "Contact update");
    },

    async addContactNote(contactId, title, content) {
      const res = await request("POST", `/Contacts/${contactId}/Notes`, {
        body: { data: [{ Note_Title: title, Note_Content: content }] },
      });
      return writeResult(res, "Note create");
    },
  };
}

/**
 * Find the Account by company name, or create it. Never creates a second Account
 * for a name that already exists.
 * @returns {{ id: string, created: boolean, ambiguous: boolean }}
 */
export async function resolveAccount(zoho, company, country) {
  const existing = await zoho.findAccountsByName(company);
  if (existing.length) return { id: existing[0].id, created: false, ambiguous: existing.length > 1 };

  try {
    const id = await zoho.createAccount({ Account_Name: company, Billing_Country: country });
    return { id, created: true, ambiguous: false };
  } catch (err) {
    // Race: another submission created it a moment ago and Account_Name is set
    // to "unique" in CRM. Use the record that now exists.
    if (err instanceof ZohoError && err.code === "DUPLICATE_DATA") {
      const dupId = err.details?.duplicate_record?.id || err.details?.id;
      if (dupId) return { id: dupId, created: false, ambiguous: false };
      const again = await zoho.findAccountsByName(company);
      if (again.length) return { id: again[0].id, created: false, ambiguous: again.length > 1 };
    }
    throw err;
  }
}

/**
 * Create-or-update the Contact (matched by email) and make sure it is linked
 * to an Account. Returns a summary of what happened, for logging.
 */
export async function processEnquiry(zoho, cfg, enquiry, now = new Date()) {
  const outcome = { contactId: null, contactCreated: false, accountId: null, accountCreated: false, notes: [] };
  const commonFields = {
    Phone: enquiry.phone,
    Mailing_Country: enquiry.country,
    ...(cfg.leadSource ? { Lead_Source: cfg.leadSource } : {}),
    // Consent is only ever switched ON from the website; withdrawal goes through unsubscribe.
    ...(cfg.consentField && enquiry.marketingConsent ? { [cfg.consentField]: true } : {}),
  };

  let contact = await zoho.findContactByEmail(enquiry.email);

  if (contact) {
    // Existing Contact: keep its current Account link; never silently re-parent it.
    let accountId = contact.Account_Name?.id || null;
    if (!accountId) {
      const acc = await resolveAccount(zoho, enquiry.company, enquiry.country);
      accountId = acc.id;
      outcome.accountCreated = acc.created;
      if (acc.ambiguous) outcome.notes.push("Several Accounts share this company name; linked to the oldest.");
    } else if (contact.Account_Name?.name && contact.Account_Name.name.toLowerCase() !== enquiry.company.toLowerCase()) {
      outcome.notes.push(`Enquiry gave company "${enquiry.company}" but Contact is linked to "${contact.Account_Name.name}". Link left unchanged.`);
    }
    const existingServices = Array.isArray(contact[cfg.servicesField]) ? contact[cfg.servicesField] : [];
    const services = [...new Set([...existingServices, ...enquiry.services])];

    await zoho.updateContact(contact.id, {
      ...commonFields,
      [cfg.servicesField]: services,
      ...(contact.Account_Name?.id ? {} : { Account_Name: { id: accountId } }),
    });
    outcome.contactId = contact.id;
    outcome.accountId = accountId;
  } else {
    const acc = await resolveAccount(zoho, enquiry.company, enquiry.country);
    if (acc.ambiguous) outcome.notes.push("Several Accounts share this company name; linked to the oldest.");
    const record = {
      ...splitName(enquiry.fullName),
      Email: enquiry.email,
      ...commonFields,
      [cfg.servicesField]: enquiry.services,
      Account_Name: { id: acc.id },
    };
    try {
      outcome.contactId = await zoho.createContact(record);
      outcome.contactCreated = true;
    } catch (err) {
      // Race on a unique Email field: fall back to updating the Contact that now exists.
      if (!(err instanceof ZohoError && err.code === "DUPLICATE_DATA")) throw err;
      contact = await zoho.findContactByEmail(enquiry.email);
      if (!contact) throw err;
      await zoho.updateContact(contact.id, { ...commonFields, [cfg.servicesField]: enquiry.services });
      outcome.contactId = contact.id;
    }
    outcome.accountId = acc.id;
    outcome.accountCreated = acc.created;
  }

  // Audit trail: one Note per submission, so repeat enquiries stay visible.
  if (cfg.addNote) {
    const content = [
      `Submitted: ${now.toISOString()}`,
      `Name: ${enquiry.fullName}`,
      `Company (as entered): ${enquiry.company}`,
      `Country: ${enquiry.country}`,
      `Services: ${enquiry.services.join(", ")}`,
      `Marketing consent: ${enquiry.marketingConsent ? "Yes" : "No"}`,
      ...outcome.notes.map((n) => `Review: ${n}`),
    ].join("\n");
    try {
      await zoho.addContactNote(outcome.contactId, "Website enquiry", content);
    } catch (err) {
      // The Contact is already saved; a missing note should not fail the enquiry.
      outcome.notes.push(`Note not saved: ${err.code || err.message}`);
    }
  }

  return outcome;
}
