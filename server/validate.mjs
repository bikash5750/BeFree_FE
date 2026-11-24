// Server-side validation. Never trust the browser: these rules mirror script.js.

export const SERVICES = [
  "Accounting Services",
  "Bookkeeping Services",
  "Payroll Services",
  "Tax Services",
  "Audit Support Services",
  "Paraplanning Services",
  "Mortgage Services",
  "Virtual Admin Services",
];
export const COUNTRIES = ["Australia", "United Kingdom", "United States", "Other"];

const str = (v) => (typeof v === "string" ? v : "");
const collapse = (v) => str(v).trim().replace(/\s+/g, " ");

/**
 * @returns {{ ok: true, value: object } | { ok: false, errors: Record<string,string> }}
 */
export function validateEnquiry(body) {
  const errors = {};
  const value = {
    fullName: collapse(body?.fullName),
    email: str(body?.email).trim().toLowerCase(),
    phone: str(body?.phone).trim(),
    company: collapse(body?.company),
    country: str(body?.country),
    services: Array.isArray(body?.services) ? [...new Set(body.services.filter((s) => typeof s === "string"))] : [],
    marketingConsent: body?.marketingConsent === true,
  };

  if (value.fullName.length < 2 || value.fullName.length > 80 || !/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(value.fullName)) {
    errors.fullName = "Please enter a valid full name.";
  }
  if (value.email.length > 100 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(value.email)) {
    errors.email = "Please enter a valid email address.";
  }
  const digits = value.phone.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(value.phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = "Please enter a valid phone number.";
  }
  if (value.company.length < 2 || value.company.length > 120) {
    errors.company = "Please enter your company or business name.";
  }
  if (!COUNTRIES.includes(value.country)) {
    errors.country = "Please select a country from the list.";
  }
  if (!value.services.length || value.services.some((s) => !SERVICES.includes(s))) {
    errors.services = "Please select at least one service from the list.";
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** "Priya Sharma" -> { First_Name: "Priya", Last_Name: "Sharma" }. Last_Name is mandatory in Zoho. */
export function splitName(fullName) {
  const parts = fullName.split(" ");
  if (parts.length === 1) return { First_Name: "", Last_Name: parts[0] };
  return { First_Name: parts.slice(0, -1).join(" "), Last_Name: parts[parts.length - 1] };
}
