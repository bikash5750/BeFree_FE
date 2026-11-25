/* ==========================================================================
   Befree — site interactions
   - Navigation (sticky state, mobile menu, active section)
   - Scroll reveals & number counters
   - Enquiry form: multi-select services, validation, secure submission
   ========================================================================== */
(() => {
  "use strict";

  /* ------------------------------------------------------------------------
     Config & constants
     ------------------------------------------------------------------------ */
  const CONFIG = Object.assign({ submitMode: "api", enquiryEndpoint: "", zohoWebform: null }, window.BEFREE_CONFIG || {});
  const REQUEST_TIMEOUT_MS = 20000;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Service options. `value` must match the Zoho CRM multi-select picklist
   * values EXACTLY (see ZOHO_INTEGRATION.md), or the CRM will reject them.
   */
  const SERVICES = [
    { value: "Accounting Services",    icon: "i-accounting" },
    { value: "Bookkeeping Services",   icon: "i-bookkeeping" },
    { value: "Payroll Services",       icon: "i-payroll" },
    { value: "Tax Services",           icon: "i-tax" },
    { value: "Audit Support Services", icon: "i-audit" },
    { value: "Paraplanning Services",  icon: "i-paraplanning" },
    { value: "Mortgage Services",      icon: "i-mortgage" },
    { value: "Virtual Admin Services", icon: "i-admin" },
  ];
  const COUNTRIES = ["Australia", "United Kingdom", "United States", "Other"];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------------------------------------------------------------------
     Header: scrolled state
     ------------------------------------------------------------------------ */
  function initHeader() {
    const header = $("#siteHeader");
    const toTop = $("#toTop");
    const root = document.documentElement;
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      const max = root.scrollHeight - window.innerHeight;
      header.classList.toggle("is-scrolled", y > 12);
      root.style.setProperty("--progress", max > 0 ? (y / max).toFixed(4) : 0);
      if (toTop) toTop.classList.toggle("is-visible", y > 700);
      ticking = false;
    };
    if (toTop) toTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
      $(".logo").focus({ preventScroll: true });
    });
    window.addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------------
     Mobile navigation
     ------------------------------------------------------------------------ */
  function initMobileNav() {
    const toggle = $("#navToggle");
    const menu = $("#navMenu");
    const scrim = $("#navScrim");
    const mobileQuery = window.matchMedia("(max-width: 960px)");

    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.classList.toggle("is-open", open);
      document.body.classList.toggle("is-locked", open);
      if (open) {
        scrim.hidden = false;
        requestAnimationFrame(() => scrim.classList.add("is-visible"));
        const firstLink = $("a", menu);
        if (firstLink) setTimeout(() => firstLink.focus(), 150);
      } else {
        scrim.classList.remove("is-visible");
        setTimeout(() => { if (!menu.classList.contains("is-open")) scrim.hidden = true; }, 350);
      }
    };
    const isOpen = () => menu.classList.contains("is-open");

    toggle.addEventListener("click", () => setOpen(!isOpen()));
    scrim.addEventListener("click", () => setOpen(false));
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) { setOpen(false); toggle.focus(); }
    });
    mobileQuery.addEventListener("change", (e) => { if (!e.matches && isOpen()) setOpen(false); });
  }

  /* ------------------------------------------------------------------------
     Active nav link while scrolling
     ------------------------------------------------------------------------ */
  function initActiveNav() {
    const links = $$(".nav__link");
    const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const sections = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);

    // Sliding pill that follows the active link (and previews on hover).
    const indicator = $(".nav__indicator");
    const moveIndicator = (link) => {
      if (!indicator || !link) return;
      indicator.style.setProperty("--ind-x", `${link.offsetLeft}px`);
      indicator.style.setProperty("--ind-w", `${link.offsetWidth}px`);
      indicator.style.setProperty("--ind-o", 1);
    };
    const activeLink = () => links.find((a) => a.classList.contains("is-active"));
    links.forEach((a) => {
      a.addEventListener("mouseenter", () => moveIndicator(a));
      a.addEventListener("mouseleave", () => moveIndicator(activeLink()));
    });
    window.addEventListener("resize", () => moveIndicator(activeLink()));
    document.fonts?.ready.then(() => moveIndicator(activeLink()));

    const setActive = (id) => links.forEach((a) => {
      const active = a === byId.get(id);
      a.classList.toggle("is-active", active);
      if (active) { a.setAttribute("aria-current", "true"); moveIndicator(a); }
      else a.removeAttribute("aria-current");
    });

    // A section is "current" when it crosses a thin band ~40% down the viewport.
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) setActive(entry.target.id); });
    }, { rootMargin: "-40% 0px -55% 0px" });
    sections.forEach((s) => observer.observe(s));
  }

  /* ------------------------------------------------------------------------
     Scroll reveal
     ------------------------------------------------------------------------ */
  function initReveal() {
    const items = $$(".reveal");
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    items.forEach((el) => observer.observe(el));
  }

  /* ------------------------------------------------------------------------
     Number counters
     ------------------------------------------------------------------------ */
  function initCounters() {
    const counters = $$("[data-count]");
    const format = new Intl.NumberFormat("en-GB");
    const render = (el, value) => { el.textContent = format.format(value); };

    if (prefersReducedMotion) { counters.forEach((el) => render(el, +el.dataset.count)); return; }

    const animate = (el) => {
      const target = +el.dataset.count;
      const duration = 1800;
      const start = performance.now();
      const easeOut = (t) => 1 - Math.pow(1 - t, 4);
      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        render(el, Math.round(target * easeOut(progress)));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { animate(entry.target); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => observer.observe(el));
  }

  /* ------------------------------------------------------------------------
     Marquee: duplicate the group once so the -50% loop is seamless
     ------------------------------------------------------------------------ */
  function initMarquee() {
    const track = $("#marqueeTrack");
    const group = track && $(".marquee__group", track);
    if (group) track.appendChild(group.cloneNode(true));
  }

  /* ------------------------------------------------------------------------
     Pointer effects (fine pointers only, motion allowed):
     hero glow + parallax, card spotlight + tilt, magnetic buttons
     ------------------------------------------------------------------------ */
  function initPointerEffects() {
    if (prefersReducedMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    // Hero: glow follows the cursor; visual layers drift at different depths.
    const hero = $(".hero");
    const glow = $("#heroGlow");
    const layers = $$(".hero__visual > *").map((el, i) => ({ el, depth: [6, 10, 14, 22, 18, 26][i] || 12 }));
    let heroFrame = 0;
    hero.addEventListener("pointermove", (e) => {
      cancelAnimationFrame(heroFrame);
      heroFrame = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        glow.style.setProperty("--gx", `${e.clientX - r.left}px`);
        glow.style.setProperty("--gy", `${e.clientY - r.top}px`);
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        layers.forEach(({ el, depth }) => { el.style.translate = `${(nx * depth).toFixed(1)}px ${(ny * depth).toFixed(1)}px`; });
      });
    });
    hero.addEventListener("pointerleave", () => layers.forEach(({ el }) => { el.style.translate = ""; }));

    // Service cards: spotlight position + gentle 3D tilt.
    $$(".service-card").forEach((card) => {
      let frame = 0;
      card.addEventListener("pointermove", (e) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          card.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
          card.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
          card.style.setProperty("--ry", `${((px - 0.5) * 8).toFixed(2)}deg`);
          card.style.setProperty("--rx", `${((0.5 - py) * 8).toFixed(2)}deg`);
        });
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });

    // Magnetic primary CTAs.
    $$(".hero__actions .btn, .nav__cta").forEach((btn) => {
      btn.classList.add("is-magnetic");
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * 0.18;
        const dy = (e.clientY - (r.top + r.height / 2)) * 0.28;
        btn.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.translate = ""; });
    });
  }

  /* Click ripple on every button */
  function initRipples() {
    if (prefersReducedMotion) return;
    document.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".btn");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.setProperty("--size", `${Math.max(r.width, r.height) * 2.2}px`);
      ripple.style.setProperty("--x", `${e.clientX - r.left}px`);
      ripple.style.setProperty("--y", `${e.clientY - r.top}px`);
      btn.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    });
  }

  /* Small confetti burst for the success modal */
  function burstConfetti(container) {
    if (prefersReducedMotion) return;
    const colors = ["#2e67f0", "#16bfa6", "#e9a23b", "#5b8bff", "#3fd8bf"];
    const wrap = document.createElement("div");
    wrap.className = "confetti";
    wrap.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 28; i++) {
      const piece = document.createElement("i");
      const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
      const dist = 90 + Math.random() * 110;
      piece.style.setProperty("--c", colors[i % colors.length]);
      piece.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      piece.style.setProperty("--dy", `${Math.sin(angle) * dist + 40}px`);
      piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      piece.style.setProperty("--delay", `${Math.random() * 0.15}s`);
      wrap.appendChild(piece);
    }
    container.appendChild(wrap);
    setTimeout(() => wrap.remove(), 1700);
  }

  /* ------------------------------------------------------------------------
     Enquiry form
     ------------------------------------------------------------------------ */
  const Validators = {
    firstName(v) {
      if (!v) return "Please enter your first name.";
      if (v.length > 40) return "Please keep your first name under 40 characters.";
      if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(v)) return "Please use letters, spaces, hyphens or apostrophes only.";
      return "";
    },
    lastName(v) {
      if (!v) return "Please enter your last name.";
      if (v.length > 80) return "Please keep your last name under 80 characters.";
      if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(v)) return "Please use letters, spaces, hyphens or apostrophes only.";
      return "";
    },
    email(v) {
      if (!v) return "Please enter your email address.";
      if (v.length > 100 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(v)) return "Please enter a valid email, e.g. name@company.com.";
      return "";
    },
    phone(v) {
      if (!v) return "Please enter your phone number.";
      const digits = v.replace(/\D/g, "");
      if (!/^\+?[\d\s().-]+$/.test(v)) return "Use digits, spaces, brackets, dashes and an optional leading +.";
      if (digits.length < 7 || digits.length > 15) return "Please enter a valid phone number (7–15 digits, including country code).";
      return "";
    },
    company(v) {
      if (!v) return "Please enter your company or business name.";
      if (v.length < 2) return "Your company name looks a little short.";
      if (v.length > 120) return "Please keep the company name under 120 characters.";
      return "";
    },
    country(v) {
      if (!v) return "Please select your country.";
      if (!COUNTRIES.includes(v)) return "Please select a country from the list.";
      return "";
    },
    services(list) {
      return list.length ? "" : "Please select at least one service.";
    },
  };

  function initEnquiryForm() {
    const form = $("[data-enquiry-form]");
    if (!form) return;

    const chipsWrap = $("#serviceChips");
    const pickCount = $("#pickCount");
    const submitBtn = $("#submitBtn");
    const statusBox = $("#formStatus");
    const statusTitle = $("#formStatusTitle");
    const statusText = $("#formStatusText");

    const inputs = {
      firstName: $("#firstName"),
      lastName: $("#lastName"),
      email: $("#email"),
      phone: $("#phone"),
      company: $("#company"),
      country: $("#country"),
    };
    const fieldWrap = {
      firstName: inputs.firstName.closest(".field"),
      lastName: inputs.lastName.closest(".field"),
      email: inputs.email.closest(".field"),
      phone: inputs.phone.closest(".field"),
      company: inputs.company.closest(".field"),
      country: inputs.country.closest(".field"),
      services: $(".services-pick", form),
    };
    const errorEl = {
      firstName: $("#firstNameError"),
      lastName: $("#lastNameError"),
      email: $("#emailError"),
      phone: $("#phoneError"),
      company: $("#companyError"),
      country: $("#countryError"),
      services: $("#servicesError"),
    };
    const touched = new Set();
    let isSubmitting = false;

    /* Render service chips (single source of truth: SERVICES) */
    chipsWrap.innerHTML = SERVICES.map((s, i) => `
      <label class="chip">
        <input type="checkbox" data-service value="${s.value}" id="svc-${i}">
        <span class="chip__body">
          <span class="chip__icon"><svg class="icon"><use href="#${s.icon}"/></svg></span>
          <span class="chip__label">${s.value}</span>
          <span class="chip__check"><svg class="icon"><use href="#i-check"/></svg></span>
        </span>
      </label>`).join("");
    const serviceBoxes = $$("input[data-service]", chipsWrap);

    const getSelectedServices = () => serviceBoxes.filter((b) => b.checked).map((b) => b.value);

    const updateCount = () => {
      const n = getSelectedServices().length;
      pickCount.textContent = `${n} selected`;
      pickCount.classList.toggle("has-items", n > 0);
      pickCount.classList.remove("bump");
      void pickCount.offsetWidth; // restart animation
      pickCount.classList.add("bump");
    };

    const clean = (v) => v.trim().replace(/\s+/g, " ");
    const readValues = () => ({
      firstName: clean(inputs.firstName.value),
      lastName: clean(inputs.lastName.value),
      fullName: clean(`${inputs.firstName.value} ${inputs.lastName.value}`),
      email: inputs.email.value.trim().toLowerCase(),
      phone: inputs.phone.value.trim(),
      company: inputs.company.value.trim().replace(/\s+/g, " "),
      country: inputs.country.value,
      services: getSelectedServices(),
      marketingConsent: $("#marketingConsent").checked,
      website: $("#website").value, // honeypot
    });

    const showFieldError = (key, message) => {
      const wrap = fieldWrap[key];
      wrap.classList.toggle("is-invalid", Boolean(message));
      wrap.classList.toggle("is-valid", !message && key !== "services");
      errorEl[key].textContent = message;
      const control = key === "services" ? wrap : inputs[key];
      control.setAttribute("aria-invalid", String(Boolean(message)));
    };

    const validateField = (key, values = readValues()) => {
      const message = Validators[key](values[key]);
      showFieldError(key, message);
      return !message;
    };

    const validateAll = (values) => {
      const keys = Object.keys(Validators);
      const results = keys.map((k) => validateField(k, values));
      const firstInvalid = keys[results.indexOf(false)];
      return { valid: !firstInvalid, firstInvalid };
    };

    const hideStatus = () => { statusBox.hidden = true; };
    const showStatus = (title, text) => {
      statusTitle.textContent = title;
      statusText.textContent = text;
      statusBox.hidden = false;
      statusBox.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
    };

    const setLoading = (loading) => {
      isSubmitting = loading;
      submitBtn.classList.toggle("is-loading", loading);
      submitBtn.setAttribute("aria-busy", String(loading));
      submitBtn.disabled = loading;
    };

    /* Live validation: validate on blur, then re-validate as the user edits */
    Object.entries(inputs).forEach(([key, input]) => {
      input.addEventListener("blur", () => { touched.add(key); validateField(key); });
      const evt = input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(evt, () => {
        if (input.tagName === "SELECT") touched.add(key);
        if (touched.has(key)) validateField(key);
      });
    });
    chipsWrap.addEventListener("change", () => {
      updateCount();
      if (touched.has("services") || fieldWrap.services.classList.contains("is-invalid")) validateField("services");
    });

    /* Submit.
       Zoho mode: validate, fill Zoho's fields, then let the browser POST the form
       to Zoho natively (no preventDefault). Zoho redirects back to this page.
       API mode: send JSON to our own endpoint and wait for confirmation. */
    form.addEventListener("submit", (e) => {
      if (isSubmitting) { e.preventDefault(); return; }
      hideStatus();

      const values = readValues();
      Object.keys(Validators).forEach((k) => touched.add(k));
      const { valid, firstInvalid } = validateAll(values);
      if (!valid) {
        e.preventDefault();
        const target = firstInvalid === "services" ? serviceBoxes[0] : inputs[firstInvalid];
        target.focus({ preventScroll: true });
        target.closest(".field").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
        return;
      }

      // Bots tend to fill hidden fields. Stop quietly; never pretend it succeeded.
      if (values.website) { e.preventDefault(); return; }

      if (CONFIG.submitMode === "api") {
        e.preventDefault();
        if (!CONFIG.enquiryEndpoint) {
          showStatus("Enquiries are temporarily unavailable.", "The enquiry service hasn't been configured yet. Please try again later.");
          return;
        }
        setLoading(true);
        submitEnquiry(values).then((result) => {
          if (result.ok) {
            openSuccessModal(values, result.reference);
          } else {
            if (result.fieldErrors) {
              Object.entries(result.fieldErrors).forEach(([k, msg]) => { if (errorEl[k]) showFieldError(k, msg); });
            }
            showStatus(result.title, result.message);
          }
        }).finally(() => setLoading(false));
        return;
      }

      prepareZohoFields(form, values);
      setLoading(true); // the page navigates to Zoho and back; no in-page result to wait for
    });

    // Coming back via the browser's Back button must not leave the button stuck on "Sending…".
    window.addEventListener("pageshow", (e) => { if (e.persisted) setLoading(false); });

    /* Reset everything after the success modal is acknowledged */
    const resetForm = () => {
      form.reset();
      touched.clear();
      Object.keys(fieldWrap).forEach((k) => {
        fieldWrap[k].classList.remove("is-invalid", "is-valid");
        errorEl[k].textContent = "";
      });
      $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
      updateCount();
      hideStatus();
    };

    initModal(resetForm);

    // Zoho sends the visitor back here (Return URL) only after it has accepted the submission.
    const params = new URLSearchParams(window.location.search);
    if (params.get("enquiry") === "sent") {
      history.replaceState(null, "", `${window.location.pathname}#contact`);
      openSuccessModal(null, "");
    }
  }

  /**
   * Fill the Zoho webform fields that the designed form doesn't hold directly.
   * Only values Zoho's picklists accept are sent as picklist values; everything
   * is also written to Description so nothing is lost.
   */
  function prepareZohoFields(form, values) {
    const cfg = CONFIG.zohoWebform || {};
    $$("[data-dynamic]", form).forEach((el) => el.remove());
    const setField = (name, value) => { form.elements.namedItem(name).value = value; };
    const addField = (name, value) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      input.dataset.dynamic = "true";
      form.appendChild(input);
    };

    if (cfg.servicesField) {
      const accepted = values.services.filter((s) => (cfg.servicesOptions || []).includes(s));
      (cfg.servicesMultiple ? accepted : accepted.slice(0, 1)).forEach((s) => addField(cfg.servicesField, s));
    }
    if (cfg.countryField && (cfg.countryOptions || []).includes(values.country)) {
      addField(cfg.countryField, values.country);
    }

    setField("Description", [
      "Website enquiry",
      `Full name: ${values.fullName}`,
      `Country: ${values.country}`,
      `Services requested (${values.services.length}): ${values.services.join(", ")}`,
      `Marketing consent: ${values.marketingConsent ? "Yes" : "No"}`,
    ].join("\n"));

    // Ask Zoho to return the visitor to this page (needs http/https; also set it in Zoho's webform settings).
    if (/^https?:$/.test(window.location.protocol)) {
      const back = new URL(window.location.href);
      back.search = "?enquiry=sent";
      back.hash = "#contact";
      setField("returnURL", back.href);
    }
  }

  /**
   * POST the enquiry to the server-side endpoint, which validates it again
   * and writes to Zoho CRM. Success is reported ONLY when the server
   * confirms the CRM write ({ ok: true }).
   */
  async function submitEnquiry(values) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const retryHint = "Your details are still in the form, so you can try again.";

    try {
      const response = await fetch(CONFIG.enquiryEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal,
      });

      let data = null;
      try { data = await response.json(); } catch { /* non-JSON response */ }

      if (response.ok && data && data.ok === true) {
        return { ok: true, reference: data.reference || "" };
      }
      if (response.status === 400 && data && data.errors) {
        return { ok: false, fieldErrors: data.errors, title: "Please check the highlighted fields.", message: "Some details couldn't be accepted." };
      }
      if (response.status === 429) {
        return { ok: false, title: "Too many attempts.", message: "Please wait a minute and try again." };
      }
      return { ok: false, title: "We couldn't send your enquiry.", message: `Something went wrong on our side. ${retryHint}` };
    } catch (err) {
      const timedOut = err && err.name === "AbortError";
      return {
        ok: false,
        title: timedOut ? "The request took too long." : "Connection problem.",
        message: timedOut
          ? `We didn't get a confirmation in time. ${retryHint}`
          : `Please check your internet connection. ${retryHint}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------------
     Success modal (focus-trapped, Escape to close)
     ------------------------------------------------------------------------ */
  let openSuccessModal = () => {};

  function initModal(onClose) {
    const modal = $("#successModal");
    const panel = $(".modal__panel", modal);
    let lastFocused = null;

    const focusables = () => $$('button, [href], input, [tabindex]:not([tabindex="-1"])', panel).filter((el) => !el.disabled);

    const close = () => {
      if (modal.hidden || modal.classList.contains("is-closing")) return;
      modal.classList.add("is-closing");
      const finish = () => {
        modal.hidden = true;
        modal.classList.remove("is-closing");
        document.body.classList.remove("is-locked");
        onClose();
        if (lastFocused) lastFocused.focus({ preventScroll: true });
      };
      prefersReducedMotion ? finish() : setTimeout(finish, 250);
    };

    // `values` is null when Zoho sent the visitor back after the redirect (no details to summarise).
    openSuccessModal = (values, reference) => {
      const hasValues = Boolean(values);
      values = values || { fullName: "", email: "", phone: "", company: "", country: "", services: [] };
      $("#summaryList").hidden = !hasValues;
      $("#summaryNameWrap").hidden = !hasValues;
      $("#summaryFirstName").textContent = values.firstName || "";
      $("#summaryName").textContent = values.fullName;
      $("#summaryEmail").textContent = values.email;
      $("#summaryPhone").textContent = values.phone;
      $("#summaryCompany").textContent = values.company;
      $("#summaryCountry").textContent = values.country;
      $("#summaryCount").textContent = values.services.length;
      const list = $("#summaryServices");
      list.replaceChildren(...values.services.map((s) => {
        const li = document.createElement("li");
        li.textContent = s;
        return li;
      }));
      const refEl = $("#summaryReference");
      refEl.hidden = !reference;
      refEl.textContent = reference ? `Reference: ${reference}` : "";

      lastFocused = document.activeElement;
      modal.hidden = false;
      document.body.classList.add("is-locked");
      panel.focus();
      burstConfetti(panel);
    };

    modal.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", () => {
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();
    initHeader();
    initMobileNav();
    initActiveNav();
    initReveal();
    initCounters();
    initMarquee();
    initPointerEffects();
    initRipples();
    initEnquiryForm();
  });
})();
