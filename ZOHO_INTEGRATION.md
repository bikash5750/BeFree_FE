# Befree website → Zoho CRM enquiry integration

## 0. Current mode: Zoho CRM Webform (Leads), `submitMode: "zohoWebform"`

The site's enquiry form **is** the Zoho CRM webform `WebToLeads1485773000000563162` (India data centre, `crm.zoho.in`), restyled with the site's CSS. It posts directly to Zoho the normal browser way. No hidden frame, no server and no credentials are needed in this mode. On submit, `script.js` validates, fills Zoho's `Last Name`, `Description`, services and `returnURL` fields, and lets the browser POST.

After Zoho accepts the submission it sends the visitor back to the site (`/?enquiry=sent#contact`), and the success message opens. If Zoho shows its own page instead, the visitor stays on Zoho's page: the site can't read Zoho's answer from another domain.

> ⚠️ **This creates Leads, not Contacts and Accounts.** Choosing this webform is an explicit move away from the Accounts/Contacts/Deals model below. Account linking and Contact de-duplication (§5) do **not** happen in this mode. Lead conversion (Lead → Contact + Account) has to be done in CRM, by people or by automation.

### What's sent where

| Website field | Zoho webform field | Note |
|---|---|---|
| Company | `Company` | Required by Zoho |
| Full name | `Last Name` (whole name) | No First Name on the webform yet; see fix 3 |
| Email | `Email` | |
| Phone | `Phone` | |
| Services (multi) | `LEADCF1` "Services List" | Currently **single-select with 5 values**, so only the first selected service that Zoho recognises is sent |
| Country | not sent | The picklist has no options yet |
| All of the above + consent | `Description` | Full record kept here, so nothing is lost |

### Changes needed in Zoho before go-live
1. **Services List (`LEADCF1`):** change it to a **Multi-Select Picklist** with all 8 services, spelled exactly as on the site (Audit Support, Paraplanning and Mortgage Services are missing). Then set `servicesMultiple: true` and list all 8 in `servicesOptions` in `index.html`.
2. **Address – Country / Region:** add Australia, United Kingdom, United States and Other. Then set `countryField: "Address - Country / Region"`.
3. **First Name:** add it to the webform. Then set `firstNameField: "First Name"`.
4. **Return URL:** in the webform settings, set it to `https://<your-domain>/?enquiry=sent#contact`. The site also sends this automatically when served over http(s), but setting it in Zoho is the safer option. **Without it, Zoho may keep the visitor on its own generic "thank you" page.**
5. **Duplicate handling:** in the webform's duplicate settings, choose to update existing Leads matched by Email, if your edition offers this.
6. **Mandatory fields:** consider making Email and Phone mandatory in Zoho too (the site already requires them).
7. **Assignment rule and notification** for webform Leads.
8. If you change any field in Zoho, **regenerate the webform** and compare the hidden `xnQsjsdp` / `xmIwtLD` values with `index.html`.

### Tested so far
A headless browser drove the real page against a **local stand-in for Zoho** (it acts like Zoho and redirects back to `returnURL`):
- An invalid form posts nothing and stays on the page with 6 field errors.
- A valid form navigates to the stand-in with the right fields (`Company`, `Last Name`, `Email`, `Phone`, `Description`, `LEADCF1`, `returnURL`, Zoho's own analytics fields; no stray fields), then returns to the site and shows the success message.
- No page JavaScript errors.

**Not yet tested against the live Zoho CRM.** Test once with the demo record (§9), then check the Lead in CRM → Leads.

### Known limits of webform mode
- The success message is shown when someone arrives at `/?enquiry=sent`. That normally only happens via Zoho's redirect, but anyone can type the address, so it is a display message and not proof of a saved record. Check Leads in CRM.
- If Zoho rejects a submission (for example a picklist value it doesn't accept), the visitor lands on a Zoho page and the site can't show its own error. That is why the picklist fixes above matter.
- The site must be served over http(s) (`npm start` or any web host), not opened as a local file.
- To switch back to the Accounts/Contacts server integration below, set `submitMode: "api"`.

---

**Status:** built and unit-tested against a simulated CRM. **Not yet tested against a live Zoho CRM org.** Nothing here should be presented as working end-to-end until the live tests in §8 have passed.

**Scope:** the original POC brief excludes live integrations. This website-to-CRM enquiry capture was requested separately and **needs sign-off against the POC scope** before go-live. It touches **Accounts and Contacts only**. It does not create Leads or Deals.

---

## 1. Approach: options compared

| | A. Zoho CRM Webform (Contacts) | B. Zoho Forms + CRM integration | **C. Custom form + secure server function (recommended)** |
|---|---|---|---|
| Visual design | Generated HTML can be restyled, but it posts to Zoho and redirects away | Embedded as an **iframe**: only Zoho Forms' own themes apply. The site's CSS **cannot** style inside it | Full control: the form is the site's own design |
| Multi-select services | Supported (multi-select picklist field) | Supported (checkbox → multi-select mapping) | Supported |
| Account match / create + Contact link | Limited. Lookup fields like *Account Name* can't be relied on in Contact webforms; needs extra CRM automation | Zoho Forms offers duplicate handling and Account mapping options; behaviour depends on edition and must be verified | Explicit, tested logic (§5) |
| Duplicate prevention | Basic options only | Configurable, edition-dependent | Search-then-write by email and company name, plus unique-field safety net |
| "Success only after CRM confirms" | No. The browser can't read the cross-origin result, so it only knows the post was sent | Inside the iframe only | Yes: the server returns `ok: true` only after Zoho confirms the write |
| Credentials | None needed (webform tokens are public by design) | None on the website | OAuth refresh token kept **on the server only** |
| Extra infrastructure | None | None | A small server/serverless function (Node, no dependencies) |

**Recommendation: Option C.** It is the only option that meets all three requirements: (1) the custom premium design, (2) reliable Account matching and Contact linking without duplicates, and (3) showing success only after the CRM confirms the write.

**Fallback if no server hosting is allowed:** Option B (Zoho Forms, embedded). It keeps credentials off the site, but the form will look like a themed Zoho form, and Account matching must be configured and verified inside Zoho Forms.

---

## 2. Architecture

```
Browser (index.html / script.js)
  │  POST /api/enquiry   JSON: name, email, phone, company, country, services[], consent
  ▼
Server function (server/server.mjs)          ← holds ZOHO_* secrets in env vars
  │  1. validate again (never trust the browser), honeypot check, rate limit
  │  2. OAuth: refresh token → short-lived access token (cached)
  │  3. Zoho CRM REST API (v8):
  │       GET  /Contacts/search?email=…
  │       GET  /Accounts/search?criteria=(Account_Name:equals:…)
  │       POST /Accounts            (only if no match)
  │       POST /Contacts  or  PUT /Contacts   (with Account_Name lookup)
  │       POST /Contacts/{id}/Notes  (audit note per submission)
  ▼
Zoho CRM: workflow, assignment and notification rules run (trigger: workflow)
  │
  └─► server replies { ok: true } only after the Contact write succeeds
      → browser shows the success modal; on any failure the browser shows an error and keeps the form filled so the person can retry
```

**Security rules (enforced in the code):**
- No Zoho token, client ID, secret or refresh token is ever in frontend code. `index.html` holds only the endpoint URL.
- The server serves only `index.html`, `style.css` and `script.js` (a whitelist), so `.env` and the source files can't be downloaded.
- Server-side validation and an exact-match whitelist for services and countries.
- Request body capped at 10 KB. Rate limit of 5 submissions per IP per 10 minutes. Hidden honeypot field to catch bots.
- Logs record CRM record IDs and error codes only, never personal data.
- The browser gets generic error messages. Zoho error details stay in the server logs.
- Use a **dedicated Zoho integration user** whose profile can only create and edit Accounts, Contacts and Notes.

---

## 3. Zoho CRM configuration

### 3.1 Fields

**Contacts module** (Setup → Customization → Modules and Fields → Contacts):

| Field label | Type | API name (must match `.env`) | Notes |
|---|---|---|---|
| Services Interested In | **Multi-Select Picklist** | `Services_Interested_In` | Values below must match **exactly** |
| Marketing Consent | Checkbox | `Marketing_Consent` | Optional. Leave `ZOHO_CONSENT_FIELD` blank to disable. Alternatively use Zoho CRM's GDPR / Data Processing Basis features if Befree already has them set up |
| First Name, Last Name, Email, Phone | Standard | `First_Name`, `Last_Name`, `Email`, `Phone` | Last Name is mandatory in Zoho |
| Mailing Country | Standard | `Mailing_Country` | Country from the form |
| Account Name | Standard lookup | `Account_Name` | Set by the server |
| Lead Source (optional) | Standard picklist | `Lead_Source` | Set `ZOHO_LEAD_SOURCE` to an **existing** picklist value, e.g. a "Website" value if Befree adds one |

Multi-select picklist values (copy exactly; they are also in `script.js` and `server/validate.mjs`):

```
Accounting Services
Bookkeeping Services
Payroll Services
Tax Services
Audit Support Services
Paraplanning Services
Mortgage Services
Virtual Admin Services
```

**Accounts module:** `Account_Name` (standard) and `Billing_Country` (standard, filled with the country for new Accounts).

### 3.2 Duplicate safety net (recommended)
Where the edition allows, set **"Do not allow duplicate values"** on:
- Contacts → **Email**
- Accounts → **Account Name**

The server already searches before it writes. These settings guard against two submissions arriving at the same moment. The server handles the resulting `DUPLICATE_DATA` response by reusing the existing record.

### 3.3 Assignment and follow-up
- **Workflow rules** on Contacts (create or edit): send an email notification to the sales owner and create a follow-up Task. The server passes `trigger: ["workflow"]`, so these rules fire on API writes.
- **Assignment:** either a workflow field update for Contact Owner, or set `ZOHO_CONTACT_ASSIGNMENT_RULE_ID` to an assignment rule ID (sent as `lar_id`; check that your edition supports assignment rules for Contacts via the API). If neither is set, the owner is the integration user.

---

## 4. Field mapping

| Website field | Required | Sent as | Zoho module.field | Rule |
|---|---|---|---|---|
| Full name | Yes | `fullName` | Contacts.`First_Name` + `Last_Name` | Last word → Last Name, the rest → First Name. Not overwritten on an existing Contact |
| Email | Yes | `email` (lower-cased) | Contacts.`Email` | **Contact match key** |
| Phone | Yes | `phone` | Contacts.`Phone` | International formats allowed, 7–15 digits |
| Company / business name | Yes | `company` | Accounts.`Account_Name` → Contacts.`Account_Name` (lookup) | **Account match key** (exact, ignoring case and extra spaces) |
| Country | Yes | `country` | Contacts.`Mailing_Country`; Accounts.`Billing_Country` (new Accounts only) | Australia / United Kingdom / United States / Other |
| Services interested in | Yes, 1 or more | `services[]` | Contacts.`Services_Interested_In` | On an existing Contact, **merged** with the values already there |
| Marketing consent | No | `marketingConsent` | Contacts.`Marketing_Consent` | Only ever set to *true* from the website. Withdrawal goes through unsubscribe or CRM, never by an unticked box |
| (every submission) | — | — | Contacts → Notes: "Website enquiry" | Timestamp, details as entered, review flags |

---

## 5. Account and Contact duplicate handling

| Situation | What the server does |
|---|---|
| **New email, new company** | Creates one Account, then one Contact linked to it |
| **New email, company already exists** | Reuses the existing Account (exact name match, ignoring case and extra spaces) and creates a Contact linked to it |
| **Several people from the same company** | Each gets their own Contact; all link to the **same** Account |
| **Email already exists** | **Updates** that Contact (phone, country, services merged, consent if ticked). Never creates a second Contact |
| **Existing Contact already linked to an Account, but a different company is entered** | Keeps the current link (never re-links automatically) and writes a "Review" line in the enquiry Note for a person to check |
| **Existing Contact with no Account** | Finds or creates the Account and links it |
| **Several Accounts already share the name** | Links to the oldest one and flags it for review in the Note. Never creates another |
| **Two submissions at the same instant** | The unique-field settings (§3.2) reject the second write; the server reuses the record that now exists |
| **Any CRM error** | Returns an error to the browser. The person sees "We couldn't send your enquiry" and can retry. **No fake success** |

**Known limitation:** company-name matching is exact. "Thames & Co" and "Thames and Co Ltd" will create two Accounts. For stricter matching, the next step would be matching on a company number or website domain (would need another form field and Befree's approval), or a scheduled review of duplicate Accounts in CRM.

---

## 6. Setup steps

1. **CRM fields:** create the fields in §3.1 and apply §3.2 and §3.3.
2. **Integration user:** create a user (or choose an existing one) with a restricted profile: Accounts and Contacts create/edit/view, Notes create.
3. **OAuth client:** sign in as that user at the API Console for your data centre (e.g. `https://api-console.zoho.eu`) → *Add Client* → **Self Client**.
   - Generate a grant code with scopes: `ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.accounts.ALL,ZohoCRM.modules.notes.CREATE`
   - Exchange it for a refresh token (within the grant code's validity window), from a terminal, not the browser:
     ```
     curl -X POST "https://accounts.zoho.eu/oauth/v2/token" \
       -d grant_type=authorization_code -d client_id=… -d client_secret=… -d code=…
     ```
   - Store the `refresh_token` from the response in the server's secret store or `.env`. **Never commit it.**
4. **Configure:** `cp .env.example .env` and fill it in. Use the domains for Befree's data centre (`.eu`, `.com`, `.com.au` …).
5. **Run locally:** `npm start` → http://localhost:8080. (Node 20.6+; no `npm install` needed.)
6. **Deploy:** any HTTPS Node host, or port `server/zoho-crm.mjs` into a serverless function (e.g. Zoho Catalyst). Keep `/api/enquiry` on the same domain as the site. If the site is hosted separately, set `enquiryEndpoint` in `index.html` to the full URL and `ALLOWED_ORIGIN` on the server.
7. **Production hardening:** add a CAPTCHA (e.g. Cloudflare Turnstile or reCAPTCHA, verified on the server). Move rate limiting to the hosting platform if you run more than one server instance.

---

## 7. Tests already run (no live CRM)

- `npm test`: 9 logic tests against an in-memory fake CRM: new Account and Contact, Account reuse (case-insensitive), shared Account for two Contacts, existing Contact updated with services merged and Account link kept, unlinked Contact gets linked, duplicate race handled, CRM errors propagate, server validation, OAuth header / 204 handling / criteria escaping. **All pass.**
- Local server checks with no credentials: static files served; `.env`, `package.json` and server sources return 404; invalid payload → 400 with field errors; valid payload → **503 `crm_not_configured`** (the site shows an error, not success); honeypot → 400; GET → 405.

These show the logic is right. They do **not** show that Befree's CRM accepts the writes.

---

## 8. Live test plan (in a Zoho sandbox, or the POC org once approved)

| # | Action | Expected in Zoho CRM |
|---|---|---|
| T1 | Submit the demo record (§9) | 1 new Account "Thames & Co Accountants"; 1 new Contact Priya Sharma linked to it; 3 services; 1 Note; workflow notification sent |
| T2 | Submit T1 again with Payroll Services added | Still 1 Contact and 1 Account; services = 4; 2 Notes |
| T3 | New person `tom@example.com`, same company | 2 Contacts under the **same** Account |
| T4 | Priya again, company "Other Ltd" | Priya still linked to Thames & Co; Note contains a "Review" line; no "Other Ltd" Account created |
| T5 | Submit with no services, or a bad email | Blocked in the browser; a direct API call returns 400; nothing written to CRM |
| T6 | Set a wrong refresh token and submit | Site shows an error and keeps the form filled; nothing written; error code in server log |
| T7 | 6 submissions within 10 minutes | 6th is rejected with "Too many attempts" |
| T8 | Tick marketing consent | `Marketing_Consent` = true on the Contact |

Record evidence for each test (screenshots of the CRM record and server log lines).

## 9. End-to-end demonstration script

1. Start the server with sandbox credentials and open the site.
2. Fill in: **Priya Sharma**, **priya@example.com**, **+44 7700 900123**, **Thames & Co Accountants**, **United Kingdom**; select **Accounting**, **Bookkeeping** and **Tax Services** (the counter shows "3 selected").
3. Submit. The button shows "Sending…", and the success modal appears only after the server confirms the write.
4. In Zoho CRM → **Contacts** → Priya Sharma: Account Name = Thames & Co Accountants; Services Interested In = the three services; Notes → "Website enquiry".
5. **Accounts** → Thames & Co Accountants → Contacts related list shows Priya.
6. Optionally run T2 and T3 live to show duplicate prevention.

Only call the demo successful once steps 4 and 5 have been seen in the connected org.

---

## 10. Open decisions for Befree

1. Sign-off that this live enquiry capture is in scope for the POC.
2. Data centre, and sandbox vs production org.
3. Who owns new Contacts, and what notification and follow-up rules apply.
4. Wording of the marketing consent text, and whether to use a CRM checkbox field or Zoho's GDPR features.
5. Whether an enquiry should also create a **Deal** (not implemented, because Deals need explicit approval and a stage/pipeline decision).
6. Hosting choice for the server function.
