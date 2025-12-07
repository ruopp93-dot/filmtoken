// ВАЖНО: задайте TMDB ключ в localStorage (movieapp_tmdb_key) или измените DEFAULT_TMDB_API_KEY
const DEFAULT_TMDB_API_KEY = "64caf85ec2b1fe28c66065dd95b5720c";

// Простая утилита debounce
function debounce(fn, delay) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const TMDB_BASE_URL = "https://api.themoviedb.org/3";
  const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";
  const FALLBACK_POSTER =
    "https://image.tmdb.org/t/p/w780/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg";

  const STORAGE_KEYS = {
    liked: "movieapp_liked",
    watched: "movieapp_watched",
    profile: "movieapp_profile",
    apiKey: "movieapp_tmdb_key"
  };

  const FEATURED_MOVIE_ID = 278; // Побег из Шоушенка

  const screens = {
    home: document.getElementById("screen-home"),
    search: document.getElementById("screen-search"),
    profile: document.getElementById("screen-profile"),
    detail: document.getElementById("screen-detail")
  };

  const tabButtons = document.querySelectorAll(".tabbar-item");

  const state = {
    cache: new Map(),
    watched: new Set(),
    liked: new Set(),
    featuredId: FEATURED_MOVIE_ID,
    seenFeatured: new Set(),
    profile: {
      name: "Гость",
      email: "guest@example.com",
      avatar: "https://i.pravatar.cc/150?img=12",
      loggedIn: false,
      onboarded: false
    },
    apiKey: DEFAULT_TMDB_API_KEY
  };
  let heroSwipeLock = false;

  /* --------- localStorage --------- */

  function readArrayFromStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("localStorage read error:", err);
      return [];
    }
  }

  function writeArrayToStorage(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (err) {
      console.warn("localStorage write error:", err);
    }
  }

  function initStateFromStorage() {
    const likedFromStorage = readArrayFromStorage(STORAGE_KEYS.liked);
    const watchedFromStorage = readArrayFromStorage(STORAGE_KEYS.watched);
    const apiKeyFromStorage = localStorage.getItem(STORAGE_KEYS.apiKey);
    const profileFromStorage = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.profile);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (err) {
        console.warn("profile read error:", err);
      }
      return null;
    })();

    state.liked = likedFromStorage.length > 0 ? new Set(likedFromStorage) : new Set();
    state.watched = watchedFromStorage.length > 0 ? new Set(watchedFromStorage) : new Set();

    if (profileFromStorage) {
      state.profile = {
        ...state.profile,
        ...profileFromStorage,
        loggedIn: Boolean(profileFromStorage.loggedIn),
        onboarded: Boolean(profileFromStorage.onboarded)
      };
    }

    state.apiKey = apiKeyFromStorage || DEFAULT_TMDB_API_KEY;
  }

  function persistLiked() {
    writeArrayToStorage(STORAGE_KEYS.liked, Array.from(state.liked));
  }

  function persistWatched() {
    writeArrayToStorage(STORAGE_KEYS.watched, Array.from(state.watched));
  }

  function persistProfile() {
    try {
      localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(state.profile));
    } catch (err) {
      console.warn("profile write error:", err);
    }
  }

  function persistApiKey() {
    try {
      localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
    } catch (err) {
      console.warn("api key write error:", err);
    }
  }

  function updateHeroLikeButton() {
    const likeBtn = document.getElementById("hero-like-btn");
    if (!likeBtn) return;
    const isLiked = state.liked.has(state.featuredId);
    likeBtn.classList.toggle("is-active", isLiked);
    likeBtn.setAttribute("aria-pressed", String(isLiked));
  }

  function updateHeroWatchButton() {
    const watchBtn = document.getElementById("hero-watch-btn");
    if (!watchBtn) return;
    const isWatched = state.watched.has(state.featuredId);
    watchBtn.classList.toggle("is-active", isWatched);
    watchBtn.setAttribute("aria-pressed", String(isWatched));
  }

  /* --------- TMDB helpers --------- */

  function buildUrl(path, params = {}) {
    const url = new URL(TMDB_BASE_URL + path);
    url.searchParams.set("api_key", state.apiKey);
    if (!Object.prototype.hasOwnProperty.call(params, "language")) {
      url.searchParams.set("language", "ru-RU");
    }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  function hasFullMovieData(movie) {
    return (
      movie &&
      typeof movie.runtime === "number" &&
      Array.isArray(movie.genres) &&
      movie.genres.length > 0
    );
  }

  // Параллельно тянем данные по списку id, не дергая сеть для уже кешированных фильмов
  async function fetchMoviesParallel(ids) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) return [];

    const cachedMap = new Map();
    const missingIds = [];

    uniqueIds.forEach((id) => {
      const cached = state.cache.get(id);
      if (cached) {
        cachedMap.set(id, cached);
      } else {
        missingIds.push(id);
      }
    });

    const fetched = await Promise.all(
      missingIds.map((id) =>
        fetchMovie(id).catch((err) => {
          console.error(err);
          return null;
        })
      )
    );
    const fetchedMap = new Map(
      fetched.filter(Boolean).map((movie) => [movie.id, movie])
    );

    return uniqueIds
      .map((id) => cachedMap.get(id) || fetchedMap.get(id))
      .filter(Boolean);
  }

  async function fetchMovie(id) {
    const cached = state.cache.get(id);
    if (cached && hasFullMovieData(cached)) {
      return cached;
    }
    const url = buildUrl(`/movie/${id}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`TMDB error for id ${id}`);
    }
    const data = await res.json();
    const merged = cached ? { ...cached, ...data } : data;
    state.cache.set(id, merged);
    return merged;
  }

  function getPosterUrl(path, size = "w500") {
    if (!path) return "";
    return `${TMDB_IMG_BASE}/${size}${path}`;
  }

  /* --------- Экраны --------- */

  function activateMainScreen(name) {
    ["home", "search", "profile"].forEach((screenName) => {
      screens[screenName].classList.toggle(
        "screen--active",
        screenName === name
      );
    });
    applyScreenEnterAnimation(screens[name]);
    screens.detail.classList.remove("screen--active");
    tabButtons.forEach((btn) => {
      btn.classList.toggle("tabbar-item--active", btn.dataset.target === name);
    });
  }

  function openDetail(id) {
    screens.detail.classList.add("screen--active");
    applyScreenEnterAnimation(screens.detail);
    screens.detail.dataset.movieId = String(id);

    const titleEl = document.getElementById("detail-title");
    const headerTitleEl = document.getElementById("detail-header-title");
    const metaEl = document.getElementById("detail-meta");
    const overviewEl = document.getElementById("detail-overview");
    const posterEl = document.getElementById("detail-poster");
    const ratingEl = document.getElementById("detail-rating");

    titleEl.textContent = "Загрузка...";
    headerTitleEl.textContent = "Карточка фильма";
    metaEl.textContent = "";
    overviewEl.textContent = "";
    ratingEl.textContent = "…";
    posterEl.removeAttribute("src");

    fetchMovie(id)
      .then((movie) => {
        renderDetail(movie);
        state.watched.add(movie.id);
        persistWatched();
        renderWatchedSection();
        renderProfile();
        updateHeroWatchButton();
      })
      .catch((err) => {
        console.error(err);
        titleEl.textContent = "Ошибка загрузки";
        overviewEl.textContent =
          "Не удалось загрузить данные фильма. Попробуйте позже.";
      });
  }

  /* --------- Главный постер (Hero) --------- */

  function renderHero(movie) {
    const heroPoster = document.getElementById("hero-poster");
    const heroTitle = document.getElementById("hero-title");
    const heroRating = document.getElementById("hero-rating");
    const heroRatingValue = heroRating?.querySelector(".hero-rating-value");

    const rawTitle = movie.title || movie.name || "Без названия";
    state.featuredId = movie.id || state.featuredId;
    state.seenFeatured.add(state.featuredId);
    const displayTitle = rawTitle.toUpperCase();
    heroTitle.textContent = displayTitle;

    if (heroRatingValue) {
      heroRatingValue.textContent =
        typeof movie.vote_average === "number"
          ? movie.vote_average.toFixed(1)
          : "—";
    }

    const posterUrl =
      getPosterUrl(movie.poster_path || movie.backdrop_path, "w780") ||
      FALLBACK_POSTER;

    if (posterUrl) {
      heroPoster.src = posterUrl;
      heroPoster.alt = `Постер фильма ${rawTitle}`;
    } else {
      heroPoster.removeAttribute("src");
      heroPoster.alt = "Постер недоступен";
    }

    triggerHeroRefresh();
    updateHeroLikeButton();
    updateHeroWatchButton();
  }

  async function loadRandomPopularMovie() {
    try {
      // Один сетевой запрос вместо цепочки попыток — меньше задержки и трафика
      const page = Math.floor(Math.random() * 5) + 1;
      const url = buildUrl("/movie/popular", { page });
      const res = await fetch(url);
      if (!res.ok) throw new Error("popular movies error");
      const data = await res.json();
      const results = (data && data.results) || [];
      if (!results.length) return;

      const unseen = results.filter((m) => !state.seenFeatured.has(m.id));
      const pool = unseen.length ? unseen : results;
      if (!unseen.length) state.seenFeatured.clear();

      const picked = pool[Math.floor(Math.random() * pool.length)];

      state.featuredId = picked.id;
      state.cache.set(picked.id, picked);

      const movie = await fetchMovie(picked.id);
      renderHero(movie);
    } catch (err) {
      console.error(err);
    }
  }

  function triggerHeroRefresh() {
    const hero = document.getElementById("hero-card");
    if (!hero) return;
    hero.classList.remove("hero--refresh");
    // force reflow to replay animation
    void hero.offsetWidth;
    hero.classList.add("hero--refresh");
  }

  /* --------- Профиль --------- */

  async function renderWatchedSection() {
    const container = document.getElementById("watched-list");
    if (!container) return;
    container.innerHTML = "";

    if (!state.watched.size) {
      const placeholder = document.createElement("div");
      placeholder.className = "profile-placeholder";
      placeholder.textContent = "Здесь появятся просмотренные фильмы";
      container.appendChild(placeholder);
      return;
    }

    const ids = Array.from(state.watched);

    const movies = await fetchMoviesParallel(ids);
    const fragment = document.createDocumentFragment();
    movies.forEach((movie) => {
      fragment.appendChild(createSmallMovieCard(movie));
    });
    container.appendChild(fragment);
  }

  async function renderLikedSection() {
    const container = document.getElementById("liked-list");
    if (!container) return;
    container.innerHTML = "";

    if (!state.liked.size) {
      const placeholder = document.createElement("div");
      placeholder.className = "profile-placeholder";
      placeholder.textContent =
        "Поставьте лайк фильму, и он появится здесь";
      container.appendChild(placeholder);
      return;
    }

    const ids = Array.from(state.liked);

    const movies = await fetchMoviesParallel(ids);
    const fragment = document.createDocumentFragment();
    movies.forEach((movie) => {
      fragment.appendChild(createSmallMovieCard(movie));
    });
    container.appendChild(fragment);
  }

  function createSmallMovieCard(movie) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "movie-card";
    card.dataset.id = movie.id;

    const poster = document.createElement("img");
    poster.className = "movie-card-poster";
    poster.loading = "lazy";

    const posterUrl = getPosterUrl(movie.poster_path, "w185");

    if (posterUrl) {
      poster.src = posterUrl;
      poster.alt = movie.title || movie.name || "Постер фильма";
    } else {
      poster.alt = "Постер недоступен";
    }

    const title = document.createElement("div");
    title.className = "movie-card-title";
    title.textContent = movie.title || movie.name || "Без названия";

    card.appendChild(poster);
    card.appendChild(title);

    card.addEventListener("click", () => openDetail(movie.id));

    return card;
  }

  function createModalItem(movie) {
    const item = document.createElement("div");
    item.className = "modal-item";

    const poster = document.createElement("img");
    poster.loading = "lazy";
    const posterUrl = getPosterUrl(movie.poster_path, "w185");
    if (posterUrl) {
      poster.src = posterUrl;
      poster.alt = movie.title || movie.name || "Постер фильма";
    } else {
      poster.alt = "Постер недоступен";
    }

    const body = document.createElement("div");
    body.className = "modal-item-body";

    const title = document.createElement("div");
    title.className = "modal-item-title";
    title.textContent = movie.title || movie.name || "Без названия";

    const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
    const rating =
      typeof movie.vote_average === "number"
        ? movie.vote_average.toFixed(1)
        : null;
    const meta = document.createElement("div");
    meta.className = "modal-item-meta";
    meta.textContent = [year, movie.runtime ? `${movie.runtime} мин` : ""]
      .filter(Boolean)
      .join(" • ");

    const ratingEl = document.createElement("div");
    ratingEl.className = "modal-item-rating";
    ratingEl.textContent = rating ? `★ ${rating}` : "—";

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(ratingEl);

    item.appendChild(poster);
    item.appendChild(body);

    item.addEventListener("click", () => openDetail(movie.id));

    return item;
  }

  function toggleLike(id) {
    if (state.liked.has(id)) {
      state.liked.delete(id);
    } else {
      state.liked.add(id);
    }
    persistLiked();
    renderLikedSection();
    renderProfile();
    updateHeroLikeButton();
  }

  function toggleWatched(id) {
    if (state.watched.has(id)) {
      state.watched.delete(id);
    } else {
      state.watched.add(id);
    }
    persistWatched();
    renderWatchedSection();
    renderProfile();
    updateHeroWatchButton();
  }

  async function populateProfileSections() {
    await Promise.all([renderWatchedSection(), renderLikedSection()]);
  }

  async function renderWatchedModal() {
    const container = document.getElementById("watched-modal-list");
    if (!container) return;
    container.innerHTML = "";

    if (!state.watched.size) {
      const placeholder = document.createElement("div");
      placeholder.className = "profile-placeholder";
      placeholder.textContent = "Нет просмотренных фильмов.";
      container.appendChild(placeholder);
      return;
    }

    const ids = Array.from(state.watched);
    const movies = await fetchMoviesParallel(ids);
    const fragment = document.createDocumentFragment();
    movies.forEach((movie) => {
      fragment.appendChild(createModalItem(movie));
    });
    container.appendChild(fragment);
  }

  /* --------- Детальный экран --------- */

  function renderDetail(movie) {
    const title = movie.title || movie.name || "Без названия";
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
    const runtime = movie.runtime ? `${movie.runtime} мин` : "";
    const genres =
      Array.isArray(movie.genres) && movie.genres.length
        ? movie.genres
            .slice(0, 3)
            .map((g) => g.name)
            .join(", ")
        : "";

    const metaParts = [year, runtime, genres].filter(Boolean);
    const rating =
      typeof movie.vote_average === "number"
        ? movie.vote_average.toFixed(1)
        : "—";

    document.getElementById("detail-title").textContent = title;
    document.getElementById("detail-header-title").textContent = title;
    document.getElementById("detail-meta").textContent = metaParts.join(" • ");
    document.getElementById("detail-rating").textContent = rating;
    document.getElementById("detail-overview").textContent =
      movie.overview || "Описание отсутствует.";

    const posterEl = document.getElementById("detail-poster");
    const posterUrl =
      getPosterUrl(movie.backdrop_path || movie.poster_path, "w780") ||
      FALLBACK_POSTER;

    if (posterUrl) {
      posterEl.src = posterUrl;
      posterEl.alt = `Постер фильма ${title}`;
    } else {
      posterEl.removeAttribute("src");
      posterEl.alt = "Постер недоступен";
    }

    const watchBtn = document.getElementById("detail-watch-btn");
    watchBtn.onclick = () => {
      openTrailer(movie.id, title);
      watchBtn.classList.add("btn-pulse");
      setTimeout(() => watchBtn.classList.remove("btn-pulse"), 250);
    };
  }

  function applyScreenEnterAnimation(el) {
    if (!el) return;
    el.classList.remove("screen--activating");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("screen--activating");
    setTimeout(() => el.classList.remove("screen--activating"), 600);
  }

  /* --------- Поиск --------- */

  function setupSearch() {
    const input = document.getElementById("search-input");
    const list = document.getElementById("search-results");
    const empty = document.getElementById("search-empty");

    if (!input) return;

    const runSearch = debounce(async (query) => {
      if (!query) {
        list.innerHTML = "";
        empty.textContent =
          "Введите название фильма, чтобы начать поиск";
        empty.hidden = false;
        return;
      }

      const url = buildUrl("/search/movie", {
        query,
        include_adult: "false",
        page: 1
      });

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("search error");

        const data = await res.json();
        const results = data.results || [];

        list.innerHTML = "";

        if (!results.length) {
          empty.textContent = "Ничего не найдено";
          empty.hidden = false;
          return;
        }

        empty.hidden = true;

        results.forEach((movie) => {
          const cached = state.cache.get(movie.id) || {};
          state.cache.set(movie.id, { ...cached, ...movie });

          const card = createSearchResultCard(movie);
          list.appendChild(card);
        });
      } catch (err) {
        console.error(err);
        list.innerHTML = "";
        empty.textContent = "Ошибка поиска. Попробуйте ещё раз.";
        empty.hidden = false;
      }
    }, 500);

    input.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      runSearch(q);
    });
  }

  function createSearchResultCard(movie) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-result";
    item.dataset.id = movie.id;

    const poster = document.createElement("img");
    poster.className = "search-result-poster";
    poster.loading = "lazy";

    const posterUrl = getPosterUrl(movie.poster_path, "w185");
    if (posterUrl) {
      poster.src = posterUrl;
      poster.alt = movie.title || movie.name || "Постер фильма";
    } else {
      poster.alt = "Постер недоступен";
    }

    const body = document.createElement("div");
    body.className = "search-result-body";

    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = movie.title || movie.name || "Без названия";

    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
    const rating =
      typeof movie.vote_average === "number"
        ? movie.vote_average.toFixed(1)
        : "—";
    const metaParts = [];
    if (year) metaParts.push(year);
    if (rating !== "—") metaParts.push(`★ ${rating}`);
    meta.textContent = metaParts.join(" • ");

    body.appendChild(title);
    body.appendChild(meta);

    item.appendChild(poster);
    item.appendChild(body);

    item.addEventListener("click", () => openDetail(movie.id));

    return item;
  }

  /* --------- Навигация и жесты --------- */

  function setupTabs() {
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.target;
        if (!target) return;
        activateMainScreen(target);
      });
    });
  }

  function setupHeroActions() {
    const likeBtn = document.getElementById("hero-like-btn");
    const watchBtn = document.getElementById("hero-watch-btn");
    const refreshBtn = document.getElementById("hero-refresh-btn");

    if (likeBtn && !likeBtn.dataset.bound) {
      likeBtn.addEventListener("click", () => {
        toggleLike(state.featuredId);
        likeBtn.classList.add("btn-pulse");
        setTimeout(() => likeBtn.classList.remove("btn-pulse"), 250);
      });
      likeBtn.dataset.bound = "true";
    }

    if (watchBtn && !watchBtn.dataset.bound) {
      watchBtn.addEventListener("click", () => {
        toggleWatched(state.featuredId);
        watchBtn.classList.add("btn-pulse");
        setTimeout(() => watchBtn.classList.remove("btn-pulse"), 250);
      });
      watchBtn.dataset.bound = "true";
    }

    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.addEventListener("click", () => {
        refreshBtn.classList.add("is-spinning");
        loadRandomPopularMovie().finally(() => {
          setTimeout(() => refreshBtn.classList.remove("is-spinning"), 400);
        });
      });
      refreshBtn.dataset.bound = "true";
    }

    updateHeroLikeButton();
    updateHeroWatchButton();
  }

  function setupBackButtons() {
    const detailBack = document.getElementById("detail-back-btn");
    if (detailBack) {
      detailBack.addEventListener("click", () => {
        screens.detail.classList.remove("screen--active");
      });
    }

    const profileBack = document.getElementById("profile-back-btn");
    if (profileBack) {
      profileBack.addEventListener("click", () =>
        activateMainScreen("home")
      );
    }
  }

  function setupProfileSeeAll() {
    const btn = document.getElementById("watched-see-all");
    const modal = document.getElementById("watched-modal");
    const modalClose = document.getElementById("watched-modal-close");
    const modalBackdrop = document.getElementById("watched-modal-backdrop");
    if (!btn || !modal) return;

    const closeModal = () => {
      modal.hidden = true;
    };

    btn.addEventListener("click", async () => {
      await renderWatchedModal();
      modal.hidden = false;
    });

    if (modalClose) modalClose.addEventListener("click", closeModal);
    if (modalBackdrop) modalBackdrop.addEventListener("click", closeModal);
  }

  function setupHeroGestures() {
    const hero = document.getElementById("hero-card");
    if (!hero) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    const threshold = 40;

    const onStart = (e) => {
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      startTime = Date.now();
    };

    const onEnd = (e) => {
      const point = e.changedTouches ? e.changedTouches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const dist = Math.max(absX, absY);
      const duration = Date.now() - startTime;

      if (dist < threshold || duration > 800) return;

      if (absX > absY) {
        if (dx > 0) {
          animateHeroSwipe("right", () => {
            toggleLike(state.featuredId);
            loadRandomPopularMovie();
          });
        } else {
          animateHeroSwipe("left", () => {
            loadRandomPopularMovie();
          });
        }
      } else if (dy < 0) {
        openDetail(state.featuredId);
      } else if (dy > 0) {
        toggleWatched(state.featuredId);
      }
    };

    hero.addEventListener("touchstart", onStart, { passive: true });
    hero.addEventListener("touchend", onEnd, { passive: true });
    hero.addEventListener("mousedown", onStart);
    hero.addEventListener("mouseup", onEnd);
  }

  function setupHeroParallax() {
    const hero = document.getElementById("hero-card");
    const poster = document.getElementById("hero-poster");
    if (!hero || !poster) return;

    const allowParallax = window.matchMedia("(pointer: fine)").matches;
    if (!allowParallax) return;

    const resetTilt = () => {
      hero.style.setProperty("--tilt-x", "0deg");
      hero.style.setProperty("--tilt-y", "0deg");
      hero.style.setProperty("--tilt-z", "0px");
      poster.style.transform = "";
    };

    let rafId = null;
    let target = { x: 0, y: 0 };

    const applyTilt = () => {
      rafId = null;
      const maxTilt = 8;
      const rotY = target.x * maxTilt * 2;
      const rotX = -target.y * maxTilt * 2;
      hero.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`);
      hero.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`);
      hero.style.setProperty("--tilt-z", "10px");
      poster.style.transform = `translateZ(24px) scale(1.04) translate(${(-target.x * 10).toFixed(2)}px, ${(-target.y * 10).toFixed(2)}px)`;
    };

    const handleMove = (evt) => {
      const rect = hero.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width - 0.5;
      const y = (evt.clientY - rect.top) / rect.height - 0.5;
      target = { x, y };
      if (rafId) return;
      rafId = requestAnimationFrame(applyTilt);
    };

    hero.addEventListener("pointermove", handleMove);
    hero.addEventListener("pointerleave", resetTilt);
    resetTilt();
  }

  function animateHeroSwipe(direction, done) {
    if (heroSwipeLock) return;
    const hero = document.getElementById("hero-card");
    if (!hero) return;
    heroSwipeLock = true;
    const cls = direction === "right" ? "hero--swipe-right" : "hero--swipe-left";
    hero.classList.remove("hero--swipe-left", "hero--swipe-right");
    void hero.offsetWidth;
    hero.classList.add(cls);

    const handleEnd = () => {
      hero.classList.remove(cls);
      hero.removeEventListener("animationend", handleEnd);
      heroSwipeLock = false;
      if (typeof done === "function") done();
    };

    hero.addEventListener("animationend", handleEnd);
  }

  function renderProfile() {
    const nameEl = document.getElementById("profile-name");
    const emailEl = document.getElementById("profile-email");
    const avatarEl = document.getElementById("profile-avatar-img");
    const statsEl = document.getElementById("profile-stats");
    const watchedSection = document.getElementById("watched-section");
    const likedSection = document.getElementById("liked-section");

    if (nameEl) nameEl.textContent = state.profile.name || "Гость";
    if (emailEl) emailEl.textContent = state.profile.email || "guest@example.com";
    if (avatarEl) {
      avatarEl.src = state.profile.avatar || "https://i.pravatar.cc/150?img=12";
      avatarEl.alt = state.profile.name || "Аватар";
    }
    if (statsEl) {
      statsEl.textContent = `Просмотрено: ${state.watched.size} • Понравилось: ${state.liked.size}`;
    }

    const form = document.getElementById("profile-form");
    if (form) {
      const nameInput = document.getElementById("profile-input-name");
      const emailInput = document.getElementById("profile-input-email");
      const passwordInput = document.getElementById("profile-input-password");
      const confirmInput = document.getElementById(
        "profile-input-password-confirm"
      );
      const feedback = document.getElementById("profile-feedback");
      if (nameInput) nameInput.value = state.profile.name || "";
      if (emailInput) emailInput.value = state.profile.email || "";

      form.onsubmit = (e) => {
        e.preventDefault();
        if (feedback) {
          feedback.textContent = "";
          feedback.classList.remove(
            "profile-feedback--error",
            "profile-feedback--success"
          );
        }

        const errors = [];
        const nameVal = nameInput?.value?.trim();
        const emailVal = emailInput?.value?.trim();
        const passwordVal = passwordInput?.value || "";
        const confirmVal = confirmInput?.value || "";

        if (!nameVal) errors.push("Укажите имя.");
        if (!emailVal || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) {
          errors.push("Введите корректный email.");
        }
        if (passwordVal.length < 8) {
          errors.push("Пароль должен быть не короче 8 символов.");
        }
        if (passwordVal !== confirmVal) {
          errors.push("Пароли не совпадают.");
        }

        if (errors.length) {
          if (feedback) {
            feedback.textContent = errors.join(" ");
            feedback.classList.add("profile-feedback--error");
          }
          return;
        }

        const isFirstRegistration = !state.profile.onboarded;

        if (isFirstRegistration) {
          state.liked.clear();
          state.watched.clear();
          persistLiked();
          persistWatched();
          renderWatchedSection();
          renderLikedSection();
        }

        state.profile = {
          name: nameVal || "Гость",
          email: emailVal || "guest@example.com",
          avatar: state.profile.avatar || "https://i.pravatar.cc/150?img=12",
          loggedIn: true,
          onboarded: true
        };
        persistProfile();
        renderProfile();
        if (feedback) {
          feedback.textContent = "Профиль сохранён.";
          feedback.classList.add("profile-feedback--success");
        }
        if (passwordInput) passwordInput.value = "";
        if (confirmInput) confirmInput.value = "";
      };
    }

    const logoutBtn = document.getElementById("profile-logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = () => {
        state.profile = {
          name: "Гость",
          email: "guest@example.com",
          avatar: "https://i.pravatar.cc/150?img=12",
          loggedIn: false,
          onboarded: state.profile.onboarded
        };
        persistProfile();
        renderProfile();
      };
    }

    const loggedIn = Boolean(state.profile.loggedIn);
    if (form) {
      form.classList.toggle("is-hidden", loggedIn);
    }
    if (logoutBtn) {
      logoutBtn.hidden = !loggedIn;
    }
    if (watchedSection) {
      watchedSection.classList.toggle("is-hidden", !loggedIn);
    }
    if (likedSection) {
      likedSection.classList.toggle("is-hidden", !loggedIn);
    }
    if (emailEl) {
      emailEl.classList.toggle("is-hidden", !loggedIn);
    }
    if (statsEl) {
      statsEl.classList.toggle("is-hidden", !loggedIn);
    }
  }

  /* --------- Трейлер --------- */

  async function openTrailer(id, title = "Трейлер") {
    const modal = document.getElementById("trailer-modal");
    const backdrop = document.getElementById("trailer-modal-backdrop");
    const closeBtn = document.getElementById("trailer-modal-close");
    const iframe = document.getElementById("trailer-iframe");
    const modalTitle = document.getElementById("trailer-modal-title");
    if (!modal || !iframe) {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`, "_blank");
      return;
    }

    const closeModal = () => {
      iframe.src = "";
      modal.hidden = true;
    };

    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.addEventListener("click", closeModal);
      closeBtn.dataset.bound = "true";
    }
    if (backdrop && !backdrop.dataset.bound) {
      backdrop.addEventListener("click", closeModal);
      backdrop.dataset.bound = "true";
    }

    try {
      const url = buildUrl(`/movie/${id}/videos`, { include_adult: "false" });
      const res = await fetch(url);
      if (!res.ok) throw new Error("video fetch failed");
      const data = await res.json();
      const results = data.results || [];

      const trailer =
        results.find(
          (v) =>
            v.type?.toLowerCase() === "trailer" &&
            v.site?.toLowerCase() === "youtube"
        ) || results.find((v) => v.site?.toLowerCase() === "youtube");

      if (!trailer || !trailer.key) {
        alert("Трейлер не найден");
        return;
      }

      iframe.src = `https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0`;
      if (modalTitle) modalTitle.textContent = title;
      modal.hidden = false;
    } catch (err) {
      console.error(err);
      alert("Не удалось открыть трейлер. Попробуйте позже.");
    }
  }

  /* --------- Старт приложения --------- */

  initStateFromStorage();
  setupTabs();
  setupBackButtons();
  setupProfileSeeAll();
  setupSearch();
  setupHeroGestures();
  setupHeroParallax();
  setupHeroActions();
  activateMainScreen("home");
  loadRandomPopularMovie()
    .catch(async () => {
      state.featuredId = FEATURED_MOVIE_ID;
      const fallback = await fetchMovie(state.featuredId);
      renderHero(fallback);
    })
    .finally(() => {
      populateProfileSections();
      renderProfile();
    });
});
