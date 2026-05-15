const EDUCATION_LABELS = {
  no_college: "No college",
  dropout: "College dropout",
  bachelors: "Bachelor's degree",
  graduate: "Graduate degree"
};

const CATEGORY_LABELS = {
  founder: "Founders",
  athlete: "Athletes",
  musician: "Musicians",
  author: "Authors",
  scientist: "Scientists",
  director: "Directors",
  media: "Media"
};

const $ = (id) => document.getElementById(id);

const state = {
  age: null,
  ageTolerance: 2,
  country: "",
  education: "",
  failures: "",
  category: ""
};

const imageCache = new Map();

function loadImageCache() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("wiki-img:")) {
        imageCache.set(k.slice("wiki-img:".length), localStorage.getItem(k) || "");
      }
    }
  } catch (e) {
    /* localStorage unavailable; in-memory only */
  }
}

async function fetchWikiImage(name) {
  if (imageCache.has(name)) return imageCache.get(name);
  try {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=240&titles=" +
      encodeURIComponent(name) +
      "&origin=*";
    const res = await fetch(url);
    const data = await res.json();
    const pages = (data && data.query && data.query.pages) || {};
    const page = Object.values(pages)[0] || {};
    const src = (page.thumbnail && page.thumbnail.source) || "";
    imageCache.set(name, src);
    try {
      localStorage.setItem("wiki-img:" + name, src);
    } catch (e) {
      /* quota or unavailable */
    }
    return src;
  } catch (e) {
    imageCache.set(name, "");
    return "";
  }
}

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function populateCountries(people) {
  const select = $("country-input");
  const countries = [...new Set(people.map((p) => p.country_of_origin))].sort();
  for (const c of countries) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

function populateCategories(people) {
  const select = $("category-input");
  const cats = [...new Set(people.map((p) => p.category))].sort();
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = CATEGORY_LABELS[c] || c;
    select.appendChild(opt);
  }
}

function matches(p) {
  if (state.age != null) {
    if (Math.abs(p.age_at_achievement - state.age) > state.ageTolerance) return false;
  }
  if (state.country && p.country_of_origin !== state.country) return false;
  if (state.education && p.education_level !== state.education) return false;
  if (state.category && p.category !== state.category) return false;
  const hasFailures = (p.prior_failures || []).length > 0;
  if (state.failures === "yes" && !hasFailures) return false;
  if (state.failures === "no" && hasFailures) return false;
  return true;
}

function sortResults(filtered) {
  if (state.age != null) {
    return [...filtered].sort(
      (a, b) =>
        Math.abs(a.age_at_achievement - state.age) -
        Math.abs(b.age_at_achievement - state.age)
    );
  }
  return [...filtered].sort((a, b) => a.age_at_achievement - b.age_at_achievement);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function avatarHtml(p) {
  const cached = imageCache.get(p.name);
  if (cached) {
    return `<img src="${escapeHtml(cached)}" alt="${escapeHtml(p.name)}"
      class="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-stone-100"
      loading="lazy" />`;
  }
  return `<div data-avatar="${escapeHtml(p.name)}"
    class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-stone-200 text-base font-semibold text-stone-600">
    ${escapeHtml(getInitials(p.name))}
  </div>`;
}

function card(p) {
  const failures = p.prior_failures || [];
  const failBadge =
    failures.length > 0
      ? `<div class="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
           <span class="font-medium">Before success:</span> ${failures.map(escapeHtml).join("; ")}
         </div>`
      : "";
  const eduLabel = EDUCATION_LABELS[p.education_level] || p.education_level;
  const eduInst = p.education_institution
    ? `, ${escapeHtml(p.education_institution)}`
    : "";
  const catLabel = CATEGORY_LABELS[p.category] || p.category;
  return `
    <article class="rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div class="flex items-start gap-4">
        ${avatarHtml(p)}
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-3">
            <h3 class="font-serif text-2xl text-stone-900">${escapeHtml(p.name)}</h3>
            <span class="shrink-0 text-xs font-medium uppercase tracking-wide text-stone-400">${escapeHtml(p.country_of_origin)}</span>
          </div>
          <p class="mt-1 text-sm text-stone-500">
            ${escapeHtml(p.achievement)} at age <span class="font-semibold text-stone-900">${p.age_at_achievement}</span>
            <span class="text-stone-400"> · ${escapeHtml(p.notability || "")}</span>
          </p>
        </div>
      </div>
      <p class="mt-4 leading-relaxed text-stone-700">${escapeHtml(p.story)}</p>
      <p class="mt-4 text-xs uppercase tracking-wide text-stone-400">${escapeHtml(catLabel)} · ${escapeHtml(eduLabel)}${eduInst}</p>
      ${failBadge}
    </article>
  `;
}

function hydrateAvatars() {
  const placeholders = document.querySelectorAll("[data-avatar]");
  placeholders.forEach((el) => {
    const name = el.dataset.avatar;
    fetchWikiImage(name).then((src) => {
      if (!src) return;
      const current = document.querySelector(
        `[data-avatar="${CSS.escape(name)}"]`
      );
      if (!current) return;
      const img = document.createElement("img");
      img.src = src;
      img.alt = name;
      img.loading = "lazy";
      img.className =
        "h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-stone-100";
      img.onerror = () => {
        /* keep the initials placeholder on error */
      };
      current.replaceWith(img);
    });
  });
}

function render() {
  const all = window.PEOPLE || [];
  const filtered = sortResults(all.filter(matches));
  $("results").innerHTML = filtered.map(card).join("");

  const heading = $("results-heading");
  const sub = $("results-sub");
  const filtersActive =
    state.age != null ||
    state.country ||
    state.education ||
    state.failures ||
    state.category;

  if (!filtersActive) {
    heading.textContent = `${all.length} people to learn from`;
    sub.textContent = "Pick a feature above to find the ones like you.";
  } else if (filtered.length === 0) {
    heading.textContent = "No matches yet";
    sub.textContent = "";
  } else if (filtered.length === 1) {
    heading.textContent = "1 person just like you reached outlier success";
    sub.textContent = "You can too.";
  } else {
    heading.textContent = `${filtered.length} people just like you reached outlier success`;
    sub.textContent = "You can too.";
  }
  $("empty-state").classList.toggle("hidden", filtered.length > 0);

  hydrateAvatars();
}

function init() {
  const people = window.PEOPLE || [];
  if (!people.length) {
    $("results-heading").textContent = "No data loaded.";
    return;
  }
  loadImageCache();
  populateCountries(people);
  populateCategories(people);

  $("age-input").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    state.age = Number.isFinite(v) ? v : null;
    render();
  });
  $("age-tolerance").addEventListener("input", (e) => {
    state.ageTolerance = parseInt(e.target.value, 10);
    const s = state.ageTolerance === 1 ? "" : "s";
    $("age-tolerance-label").textContent = `Age tolerance: ±${state.ageTolerance} year${s}`;
    render();
  });
  $("country-input").addEventListener("change", (e) => {
    state.country = e.target.value;
    render();
  });
  $("education-input").addEventListener("change", (e) => {
    state.education = e.target.value;
    render();
  });
  $("failures-input").addEventListener("change", (e) => {
    state.failures = e.target.value;
    render();
  });
  $("category-input").addEventListener("change", (e) => {
    state.category = e.target.value;
    render();
  });
  $("reset-btn").addEventListener("click", () => {
    state.age = null;
    state.ageTolerance = 2;
    state.country = "";
    state.education = "";
    state.failures = "";
    state.category = "";
    $("age-input").value = "";
    $("age-tolerance").value = 2;
    $("age-tolerance-label").textContent = "Age tolerance: ±2 years";
    $("country-input").value = "";
    $("education-input").value = "";
    $("failures-input").value = "";
    $("category-input").value = "";
    render();
  });

  render();
}

init();
