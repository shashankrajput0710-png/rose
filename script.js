const PAGE_TURN_MS = 980;
const PUZZLE_MISSING_INDEX = 4;
const HEART_VIEWBOX = { width: 460, height: 340 };

const STORAGE_KEYS = {
  notes: "rose-story-notes",
  customPages: "rose-story-custom-pages",
  liveNote: "rose-story-live-note"
};

const appConfig = window.ROSE_CONFIG || {};
const remoteInboxConfig = normalizeRemoteInboxConfig(appConfig.remoteInbox);

const pageShell = document.getElementById("pageShell");
const pageLabel = document.getElementById("pageLabel");
const prevButton = document.getElementById("prevButton");
const nextButton = document.getElementById("nextButton");
const restartButton = document.getElementById("restartButton");
const openBookButton = document.getElementById("openBookButton");
const bookFrame = document.getElementById("bookFrame");
const burnOverlay = document.getElementById("burnOverlay");
const neverEndingBook = document.getElementById("neverEndingBook");

const quizButtons = document.getElementById("quizButtons");
const yesButton = document.getElementById("yesButton");
const noButton = document.getElementById("noButton");
const page1Message = document.getElementById("page1Message");

const flowerStage = document.getElementById("flowerStage");
const waterButton = document.getElementById("waterButton");
const rosePortrait = document.getElementById("rosePortrait");

const puzzleBoard = document.getElementById("puzzleBoard");
const missingPieceNote = document.getElementById("missingPieceNote");
const missingPieceYes = document.getElementById("missingPieceYes");
const missingPieceNo = document.getElementById("missingPieceNo");
const missingPieceReveal = document.getElementById("missingPieceReveal");

const heartMaze = document.getElementById("heartMaze");
const heartPath = document.getElementById("heartPath");
const heartToken = document.getElementById("heartToken");
const videoReveal = document.getElementById("videoReveal");
const roseVideo = document.getElementById("roseVideo");

const letterArea = document.getElementById("letterArea");
const letterStatus = document.getElementById("letterStatus");
const inboxButton = document.getElementById("inboxButton");
const inboxModal = document.getElementById("inboxModal");
const closeInboxButton = document.getElementById("closeInboxButton");
const inboxEntries = document.getElementById("inboxEntries");

const envelopeButton = document.getElementById("envelopeButton");
const musicPlayer = document.getElementById("musicPlayer");
const roseSong = document.getElementById("roseSong");
const musicToggle = document.getElementById("musicToggle");
const musicSeek = document.getElementById("musicSeek");
const musicCurrent = document.getElementById("musicCurrent");
const musicDuration = document.getElementById("musicDuration");

const toggleCustomForm = document.getElementById("toggleCustomForm");
const customForm = document.getElementById("customForm");
const customPageId = document.getElementById("customPageId");
const customTitle = document.getElementById("customTitle");
const customBody = document.getElementById("customBody");
const customAccent = document.getElementById("customAccent");
const cancelCustomForm = document.getElementById("cancelCustomForm");
const customPagesList = document.getElementById("customPagesList");

const adminMode = new URLSearchParams(window.location.search).get("admin") === "rose";

const state = {
  currentIndex: 0,
  isAnimating: false,
  pendingPageIndex: null,
  coverOpened: false,
  page1Done: false,
  page2Done: false,
  page3Done: false,
  page4Done: false,
  storyEnded: false,
  puzzleSelectedSlot: null,
  puzzleBoard: [],
  puzzleWholeShown: false,
  customPages: [],
  heartLength: 0,
  heartDragging: false,
  heartAutoAnimating: false,
  letterSaveTimer: null,
  liveNoteId: null,
  puzzleImageUrl: "assets/placeholder-puzzle.svg"
};

initialize();

function initialize() {
  state.customPages = loadCustomPages();
  state.liveNoteId = ensureLiveNoteId();

  setupStaticAssets();
  renderCustomPages();
  renderCustomPagesList();
  initializePuzzleBoard();
  initializeHeartToken();
  void initializeLetter();
  initializeMusicPlayer();
  initializeAdminMode();
  wireEvents();
  updateNavigation();
}

function wireEvents() {
  openBookButton.addEventListener("click", () => {
    state.coverOpened = true;
    updateNavigation();
    window.setTimeout(() => {
      goToPage(1);
    }, 180);
  });

  prevButton.addEventListener("click", () => {
    const visibleIndex = getVisiblePageIndex();
    if (!state.storyEnded) {
      goToPage(visibleIndex - 1);
    }
  });

  nextButton.addEventListener("click", () => {
    const pages = getPages();
    const visibleIndex = getVisiblePageIndex();
    const nextIndex = visibleIndex + 1;

    if (state.storyEnded || nextIndex >= pages.length || !canAdvanceFromPageIndex(visibleIndex)) {
      return;
    }

    goToPage(nextIndex);
  });

  restartButton.addEventListener("click", () => {
    window.location.reload();
  });

  yesButton.addEventListener("click", () => {
    state.page1Done = true;
    page1Message.textContent = "Knew it. The page turns only after a little smile.";
    updateNavigation();
    window.setTimeout(() => {
      goToPage(getIndexById("page-2"));
    }, 760);
  });

  ["mouseenter", "pointerdown", "focus"].forEach((eventName) => {
    noButton.addEventListener(eventName, (event) => {
      event.preventDefault();
      moveNoButton();
    });
  });

  waterButton.addEventListener("click", () => {
    if (flowerStage.classList.contains("is-watered") || flowerStage.classList.contains("is-watering")) {
      return;
    }

    const splash = flowerStage.querySelector(".flower-stage__splash");
    const splashClone = splash.cloneNode(true);
    splash.replaceWith(splashClone);

    flowerStage.classList.add("is-watering");
    waterButton.disabled = true;
    waterButton.textContent = "Watering...";

    window.setTimeout(() => {
      flowerStage.classList.add("is-watered");
      waterButton.textContent = "Blooming...";
    }, 650);

    window.setTimeout(() => {
      flowerStage.classList.remove("is-watering");
    }, 1400);

    window.setTimeout(() => {
      state.page2Done = true;
      waterButton.textContent = "Rose Bloomed";
      updateNavigation();
    }, 2500);
  });

  puzzleBoard.addEventListener("click", handlePuzzleBoardClick);

  missingPieceYes.addEventListener("click", () => {
    if (state.page3Done || state.storyEnded) {
      return;
    }

    missingPieceReveal.classList.remove("is-hidden");
    missingPieceNote.querySelector(".decision-buttons").style.pointerEvents = "none";
    window.setTimeout(() => {
      state.page3Done = true;
      state.puzzleWholeShown = true;
      puzzleBoard.classList.remove("is-shattering");
      puzzleBoard.classList.add("is-whole");
      puzzleBoard.innerHTML = "";
      updateNavigation();
    }, 420);
  });

  missingPieceNo.addEventListener("click", () => {
    if (state.storyEnded) {
      return;
    }

    state.storyEnded = true;
    bookFrame.classList.add("story-ended");
    burnOverlay.classList.remove("is-hidden");
    updateNavigation();

    window.setTimeout(() => {
      burnOverlay.classList.add("is-hidden");
      neverEndingBook.classList.remove("is-hidden");
    }, 2350);
  });

  heartMaze.addEventListener("pointerdown", startHeartDrag);
  heartToken.addEventListener("click", () => {
    if (state.page4Done || state.storyEnded || state.heartAutoAnimating) {
      return;
    }

    guideHeartToDoor();
  });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!state.heartDragging) {
        return;
      }

      event.preventDefault();
      updateHeartFromPointer(event);
    },
    { passive: false }
  );
  window.addEventListener("pointerup", stopHeartDrag);
  window.addEventListener("pointercancel", stopHeartDrag);

  letterArea.addEventListener("input", () => {
    autoresizeTextarea(letterArea);
    letterStatus.textContent = remoteInboxConfig.enabled ? "Saving secret note..." : "Saving...";
    window.clearTimeout(state.letterSaveTimer);
    state.letterSaveTimer = window.setTimeout(saveLetter, 700);
  });

  envelopeButton.addEventListener("click", async () => {
    envelopeButton.classList.add("is-open");
    musicPlayer.classList.remove("is-hidden");

    try {
      await roseSong.play();
      musicToggle.textContent = "Pause";
    } catch (error) {
      musicToggle.textContent = "Play";
    }
  });

  musicToggle.addEventListener("click", async () => {
    if (roseSong.paused) {
      try {
        await roseSong.play();
        musicToggle.textContent = "Pause";
      } catch (error) {
        musicToggle.textContent = "Play";
      }
    } else {
      roseSong.pause();
      musicToggle.textContent = "Play";
    }
  });

  musicSeek.addEventListener("input", () => {
    if (!roseSong.duration) {
      return;
    }

    roseSong.currentTime = (Number(musicSeek.value) / 100) * roseSong.duration;
  });

  roseSong.addEventListener("loadedmetadata", updateMusicUI);
  roseSong.addEventListener("timeupdate", updateMusicUI);
  roseSong.addEventListener("pause", () => {
    musicToggle.textContent = "Play";
  });
  roseSong.addEventListener("play", () => {
    musicToggle.textContent = "Pause";
  });

  toggleCustomForm.addEventListener("click", () => {
    customForm.classList.toggle("is-hidden");
    if (!customForm.classList.contains("is-hidden")) {
      customTitle.focus();
    }
  });

  cancelCustomForm.addEventListener("click", resetCustomForm);

  customForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const entry = {
      id: customPageId.value || makeId("page"),
      title: customTitle.value.trim() || "A New Page",
      body: customBody.value.trim() || "A page written for later.",
      accent: customAccent.value
    };

    const existingIndex = state.customPages.findIndex((page) => page.id === entry.id);
    if (existingIndex >= 0) {
      state.customPages[existingIndex] = entry;
    } else {
      state.customPages.push(entry);
    }

    saveCustomPages();
    resetCustomForm();

    const newIndex = getIndexById(`custom-page-${entry.id}`);
    if (newIndex >= 0) {
      goToPage(newIndex);
    }
  });

  customPagesList.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-action='edit']");
    const deleteButton = event.target.closest("[data-action='delete']");

    if (editButton) {
      const pageId = editButton.dataset.id;
      const page = state.customPages.find((entry) => entry.id === pageId);
      if (!page) {
        return;
      }

      customPageId.value = page.id;
      customTitle.value = page.title;
      customBody.value = page.body;
      customAccent.value = page.accent;
      customForm.classList.remove("is-hidden");
      customTitle.focus();
      return;
    }

    if (deleteButton) {
      const pageId = deleteButton.dataset.id;
      state.customPages = state.customPages.filter((entry) => entry.id !== pageId);
      saveCustomPages();
    }
  });

  closeInboxButton.addEventListener("click", closeInbox);
  inboxModal.addEventListener("click", (event) => {
    if (event.target === inboxModal) {
      closeInbox();
    }
  });

  pageShell.addEventListener("pointerdown", handleSwipeStart, { passive: true });
  pageShell.addEventListener("pointerup", handleSwipeEnd, { passive: true });
}

function setupStaticAssets() {
  applyImageFallback(rosePortrait, "assets/page2-photo.jpg", "assets/placeholder-portrait.svg");
  resolveAsset("assets/page3-puzzle.jpg", "assets/placeholder-puzzle.svg").then((resolvedUrl) => {
    state.puzzleImageUrl = resolvedUrl;
    puzzleBoard.style.setProperty("--piece-image", `url("${resolvedUrl}")`);
    renderPuzzleBoard();
  });
}

function initializeAdminMode() {
  if (!adminMode) {
    return;
  }

  inboxButton.classList.remove("is-hidden");
  inboxButton.addEventListener("click", () => {
    void renderInbox();
    inboxModal.classList.remove("is-hidden");
  });
}

async function initializeLetter() {
  const existing = (await loadNotes()).find((note) => note.id === state.liveNoteId);
  if (existing) {
    letterArea.value = existing.body;
    autoresizeTextarea(letterArea);
    letterStatus.textContent = `Loaded draft from ${formatDate(existing.updatedAt)}`;
  } else {
    letterStatus.textContent = remoteInboxConfig.enabled
      ? "Secret sync is ready. Write whatever you want."
      : "Waiting for words...";
  }
}

function initializeMusicPlayer() {
  if (!roseSong) {
    return;
  }

  updateMusicUI();
}

function closeInbox() {
  inboxModal.classList.add("is-hidden");
}

async function loadNotes() {
  const localNotes = loadLocalNotes();

  if (!remoteInboxConfig.enabled) {
    return localNotes;
  }

  try {
    const remoteNotes = await fetchRemoteNotes();
    if (remoteNotes.length) {
      saveLocalNotes(remoteNotes);
      return remoteNotes;
    }
  } catch (error) {
    console.error("Remote inbox fetch failed", error);
  }

  return localNotes;
}

function loadLocalNotes() {
  return loadJson(STORAGE_KEYS.notes, []);
}

function saveLocalNotes(notes) {
  localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes));
}

async function saveLetter() {
  const text = letterArea.value.trim();

  if (!text) {
    letterStatus.textContent = "Waiting for words...";
    return;
  }

  const notes = loadLocalNotes();
  const now = new Date().toISOString();
  const existing = notes.find((note) => note.id === state.liveNoteId);
  let savedNote;

  if (existing) {
    existing.body = text;
    existing.updatedAt = now;
    savedNote = existing;
  } else {
    savedNote = {
      id: state.liveNoteId,
      body: text,
      createdAt: now,
      updatedAt: now
    };
    notes.push(savedNote);
  }

  saveLocalNotes(notes);

  if (remoteInboxConfig.enabled) {
    try {
      await upsertRemoteNote(savedNote);
      letterStatus.textContent = `Secret note synced at ${formatClock(now)}`;
    } catch (error) {
      console.error("Remote inbox save failed", error);
      letterStatus.textContent = `Saved on this device at ${formatClock(now)}`;
    }
  } else {
    letterStatus.textContent = `Saved on this device at ${formatClock(now)}`;
  }

  void renderInbox();
}

async function renderInbox() {
  if (!adminMode) {
    return;
  }

  inboxEntries.innerHTML = "";
  const notes = (await loadNotes()).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));

  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = remoteInboxConfig.enabled
      ? "No synced notes yet."
      : "No saved notes yet on this browser.";
    inboxEntries.append(empty);
    return;
  }

  notes.forEach((note) => {
    const card = document.createElement("article");
    card.className = "inbox-entry";

    const meta = document.createElement("p");
    meta.className = "inbox-entry__meta";
    meta.textContent = `Saved ${formatDate(note.updatedAt)}`;

    const body = document.createElement("p");
    body.className = "inbox-entry__body";
    body.textContent = note.body;

    card.append(meta, body);
    inboxEntries.append(card);
  });
}

function normalizeRemoteInboxConfig(config) {
  const safeConfig = config || {};
  return {
    enabled: Boolean(safeConfig.enabled && safeConfig.url && safeConfig.anonKey),
    provider: safeConfig.provider || "supabase",
    url: (safeConfig.url || "").replace(/\/$/, ""),
    anonKey: safeConfig.anonKey || "",
    table: safeConfig.table || "rose_notes",
    storyId: safeConfig.storyId || "rose-book"
  };
}

function getRemoteRestUrl() {
  return `${remoteInboxConfig.url}/rest/v1/${remoteInboxConfig.table}`;
}

async function fetchRemoteNotes() {
  const query = new URLSearchParams({
    select: "id,body,created_at,updated_at,story_id",
    story_id: `eq.${remoteInboxConfig.storyId}`,
    order: "updated_at.desc"
  });

  const response = await fetch(`${getRemoteRestUrl()}?${query.toString()}`, {
    headers: {
      apikey: remoteInboxConfig.anonKey,
      Authorization: `Bearer ${remoteInboxConfig.anonKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Remote fetch failed with ${response.status}`);
  }

  const rows = await response.json();
  return rows.map(mapRemoteNote);
}

async function upsertRemoteNote(note) {
  const payload = [{
    id: note.id,
    body: note.body,
    story_id: remoteInboxConfig.storyId,
    created_at: note.createdAt,
    updated_at: note.updatedAt
  }];

  const response = await fetch(`${getRemoteRestUrl()}?on_conflict=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: remoteInboxConfig.anonKey,
      Authorization: `Bearer ${remoteInboxConfig.anonKey}`,
      Prefer: "return=representation,resolution=merge-duplicates"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Remote save failed with ${response.status}`);
  }

  const rows = await response.json();
  if (rows.length) {
    const remoteNotes = loadLocalNotes().filter((entry) => entry.id !== note.id);
    remoteNotes.push(mapRemoteNote(rows[0]));
    saveLocalNotes(remoteNotes);
  }
}

function mapRemoteNote(row) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function loadCustomPages() {
  return loadJson(STORAGE_KEYS.customPages, []);
}

function saveCustomPages() {
  localStorage.setItem(STORAGE_KEYS.customPages, JSON.stringify(state.customPages));
  renderCustomPages();
  renderCustomPagesList();
  updateNavigation();
}

function renderCustomPages() {
  const currentPageId = getPages()[state.currentIndex]?.id || "page-cover";

  pageShell.querySelectorAll(".page--custom").forEach((page) => page.remove());

  const fragment = document.createDocumentFragment();
  state.customPages.forEach((entry) => {
    const section = document.createElement("section");
    section.className = "page page--custom";
    section.id = `custom-page-${entry.id}`;
    section.dataset.title = entry.title;
    section.dataset.accent = entry.accent;

    const content = document.createElement("div");
    content.className = "page-content";

    const kicker = document.createElement("p");
    kicker.className = "script-kicker";
    kicker.textContent = "Added Page";

    const glow = document.createElement("div");
    glow.className = "custom-page-glow";

    const title = document.createElement("h2");
    title.className = "page-heading page-heading--script";
    title.textContent = entry.title;

    const body = document.createElement("p");
    body.className = "custom-page-body";
    body.textContent = entry.body;

    content.append(kicker, glow, title, body);
    section.append(content);
    fragment.append(section);
  });

  pageShell.append(fragment);

  const newIndex = getIndexById(currentPageId);
  state.currentIndex = newIndex >= 0 ? newIndex : 0;
  getPages().forEach((page, index) => {
    page.classList.toggle("is-active", index === state.currentIndex);
  });
}

function renderCustomPagesList() {
  customPagesList.innerHTML = "";

  if (!state.customPages.length) {
    const empty = document.createElement("p");
    empty.className = "custom-pages-list__empty";
    empty.textContent = "No extra pages yet. Add one and it becomes part of the book.";
    customPagesList.append(empty);
    return;
  }

  state.customPages.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "custom-page-row";

    const textGroup = document.createElement("div");
    textGroup.className = "custom-page-row__text";

    const title = document.createElement("span");
    title.className = "custom-page-row__title";
    title.textContent = entry.title;

    const excerpt = document.createElement("span");
    excerpt.className = "custom-page-row__excerpt";
    excerpt.textContent = entry.body.length > 90 ? `${entry.body.slice(0, 90)}...` : entry.body;

    textGroup.append(title, excerpt);

    const actions = document.createElement("div");
    actions.className = "custom-page-row__actions";

    const edit = document.createElement("button");
    edit.className = "chip-button";
    edit.type = "button";
    edit.dataset.action = "edit";
    edit.dataset.id = entry.id;
    edit.textContent = "Edit";

    const remove = document.createElement("button");
    remove.className = "chip-button";
    remove.type = "button";
    remove.dataset.action = "delete";
    remove.dataset.id = entry.id;
    remove.textContent = "Delete";

    actions.append(edit, remove);
    row.append(textGroup, actions);
    customPagesList.append(row);
  });
}

function resetCustomForm() {
  customPageId.value = "";
  customTitle.value = "";
  customBody.value = "";
  customAccent.value = "rose";
  customForm.classList.add("is-hidden");
}

function getPages() {
  return Array.from(pageShell.querySelectorAll(".page"));
}

function getIndexById(id) {
  return getPages().findIndex((page) => page.id === id);
}

function canAdvanceFromCurrentPage() {
  return canAdvanceFromPageIndex(state.currentIndex);
}

function canAdvanceFromPageIndex(pageIndex) {
  const currentPage = getPages()[pageIndex];
  if (!currentPage || state.storyEnded) {
    return false;
  }

  switch (currentPage.id) {
    case "page-cover":
      return state.coverOpened;
    case "page-1":
      return state.page1Done;
    case "page-2":
      return state.page2Done;
    case "page-3":
      return state.page3Done;
    case "page-4":
      return state.page4Done;
    default:
      return true;
  }
}

function updateNavigation() {
  const pages = getPages();
  const visibleIndex = getVisiblePageIndex();
  const currentPage = pages[visibleIndex];
  const pageTitle = currentPage?.dataset.title || "Cover";

  pageLabel.textContent = `${pageTitle} · ${visibleIndex + 1}/${pages.length}`;
  prevButton.disabled = state.storyEnded || visibleIndex === 0;
  nextButton.disabled = state.storyEnded || visibleIndex >= pages.length - 1 || !canAdvanceFromPageIndex(visibleIndex);
}

function goToPage(targetIndex) {
  const pages = getPages();
  const currentPage = pages[state.currentIndex];
  const targetPage = pages[targetIndex];

  if (
    !targetPage ||
    targetIndex === state.currentIndex ||
    targetIndex < 0 ||
    targetIndex >= pages.length
  ) {
    return;
  }

  if (state.isAnimating) {
    state.pendingPageIndex = targetIndex;
    return;
  }

  state.isAnimating = true;
  state.pendingPageIndex = null;
  pauseMedia();

  const goingForward = targetIndex > state.currentIndex;
  targetPage.classList.add("is-active", goingForward ? "is-enter-next" : "is-enter-prev");
  currentPage.classList.remove("is-active");
  currentPage.classList.add(goingForward ? "is-exit-next" : "is-exit-prev");

  window.setTimeout(() => {
    currentPage.classList.remove("is-exit-next", "is-exit-prev");
    targetPage.classList.remove("is-enter-next", "is-enter-prev");

    pages.forEach((page, index) => {
      page.classList.toggle("is-active", index === targetIndex);
    });

    state.currentIndex = targetIndex;
    state.isAnimating = false;
    updateNavigation();

    if (state.pendingPageIndex !== null && state.pendingPageIndex !== state.currentIndex) {
      const queuedTarget = state.pendingPageIndex;
      state.pendingPageIndex = null;
      goToPage(queuedTarget);
    }
  }, PAGE_TURN_MS + 20);
}

function pauseMedia() {
  if (roseVideo && !roseVideo.paused) {
    roseVideo.pause();
  }

  if (roseSong && !roseSong.paused) {
    roseSong.pause();
  }
}

function getVisiblePageIndex() {
  const pages = getPages();
  const visibleIndex = pages.findIndex((page) => page.classList.contains("is-active"));
  return visibleIndex >= 0 ? visibleIndex : state.currentIndex;
}

function moveNoButton() {
  const containerRect = quizButtons.getBoundingClientRect();
  const maxX = Math.max(16, containerRect.width - noButton.offsetWidth - 16);
  const maxY = Math.max(16, containerRect.height - noButton.offsetHeight - 16);
  const nextX = Math.random() * maxX;
  const nextY = Math.random() * maxY;
  const spin = Math.round((Math.random() * 24) - 12);
  noButton.style.transform = `translate(${nextX}px, ${nextY}px) rotate(${spin}deg)`;
}

function initializePuzzleBoard() {
  const pieces = [0, 1, 2, 3, 5, 6, 7, 8];
  let shuffled = [];

  do {
    shuffled = shuffle(pieces);
  } while (shuffled.every((piece, index) => piece === (index < PUZZLE_MISSING_INDEX ? index : index + 1)));

  state.puzzleBoard = Array(9).fill(null);
  let pieceIndex = 0;

  for (let slot = 0; slot < 9; slot += 1) {
    if (slot === PUZZLE_MISSING_INDEX) {
      continue;
    }

    state.puzzleBoard[slot] = shuffled[pieceIndex];
    pieceIndex += 1;
  }

  renderPuzzleBoard();
}

function renderPuzzleBoard() {
  if (!puzzleBoard) {
    return;
  }

  puzzleBoard.innerHTML = "";
  puzzleBoard.style.setProperty("--piece-image", `url("${state.puzzleImageUrl}")`);

  for (let slot = 0; slot < 9; slot += 1) {
    if (slot === PUZZLE_MISSING_INDEX) {
      const missing = document.createElement("button");
      missing.type = "button";
      missing.className = "puzzle-cell puzzle-cell--missing";
      missing.disabled = true;
      puzzleBoard.append(missing);
      continue;
    }

    const piece = state.puzzleBoard[slot];
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "puzzle-tile";
    tile.dataset.slot = String(slot);
    tile.dataset.piece = String(piece);
    tile.style.backgroundPosition = `${(piece % 3) * 50}% ${Math.floor(piece / 3) * 50}%`;
    tile.style.setProperty("--scatter-x", `${((slot % 3) - 1) * 86}px`);
    tile.style.setProperty("--scatter-y", `${(Math.floor(slot / 3) - 1) * 82}px`);
    tile.style.setProperty("--scatter-r", `${((slot * 17) % 30) - 15}deg`);

    if (state.puzzleSelectedSlot === slot) {
      tile.classList.add("is-selected");
    }

    puzzleBoard.append(tile);
  }
}

function handlePuzzleBoardClick(event) {
  if (state.storyEnded || state.page3Done || puzzleBoard.classList.contains("is-shattering")) {
    return;
  }

  const tile = event.target.closest(".puzzle-tile");
  if (!tile) {
    return;
  }

  const slot = Number(tile.dataset.slot);

  if (state.puzzleSelectedSlot === null) {
    state.puzzleSelectedSlot = slot;
    renderPuzzleBoard();
    return;
  }

  if (state.puzzleSelectedSlot === slot) {
    state.puzzleSelectedSlot = null;
    renderPuzzleBoard();
    return;
  }

  const selectedSlot = state.puzzleSelectedSlot;
  [state.puzzleBoard[selectedSlot], state.puzzleBoard[slot]] = [state.puzzleBoard[slot], state.puzzleBoard[selectedSlot]];
  state.puzzleSelectedSlot = null;
  renderPuzzleBoard();

  if (isPuzzleSolved()) {
    puzzleBoard.classList.add("is-shattering");
    window.setTimeout(() => {
      missingPieceNote.classList.remove("is-hidden");
    }, 900);
  }
}

function isPuzzleSolved() {
  return state.puzzleBoard.every((piece, slot) => {
    if (slot === PUZZLE_MISSING_INDEX) {
      return piece === null;
    }

    return piece === slot;
  });
}

function startHeartDrag(event) {
  if (
    state.storyEnded ||
    state.page4Done ||
    state.heartAutoAnimating ||
    getPages()[state.currentIndex]?.id !== "page-4"
  ) {
    return;
  }

  state.heartDragging = true;
  updateHeartFromPointer(event);
}

function stopHeartDrag() {
  state.heartDragging = false;
}

function initializeHeartToken() {
  state.heartLength = 0;
  positionHeartToken(0);
}

function updateHeartFromPointer(event) {
  const svg = heartMaze.querySelector("svg");
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;

  const svgPoint = point.matrixTransform(svg.getScreenCTM().inverse());
  const closest = findClosestLengthOnPath(heartPath, svgPoint);

  if (closest.distance > 28) {
    return;
  }

  if (closest.length > state.heartLength + 64) {
    return;
  }

  state.heartLength = closest.length;
  positionHeartToken(state.heartLength);

  if (state.heartLength >= heartPath.getTotalLength() - 8) {
    completeHeartPuzzle();
  }
}

function completeHeartPuzzle() {
  if (state.page4Done) {
    return;
  }

  state.page4Done = true;
  stopHeartDrag();
  positionHeartToken(heartPath.getTotalLength());
  videoReveal.classList.remove("is-hidden");
  updateNavigation();
}

function guideHeartToDoor() {
  const totalLength = heartPath.getTotalLength();
  const startLength = state.heartLength;
  const startTime = performance.now();
  const duration = 1500;

  state.heartAutoAnimating = true;

  function step(timestamp) {
    const progress = Math.min(1, (timestamp - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    state.heartLength = startLength + ((totalLength - startLength) * eased);
    positionHeartToken(state.heartLength);

    if (progress < 1) {
      window.requestAnimationFrame(step);
      return;
    }

    state.heartAutoAnimating = false;
    completeHeartPuzzle();
  }

  window.requestAnimationFrame(step);
}

function positionHeartToken(pathLength) {
  const point = heartPath.getPointAtLength(pathLength);
  heartToken.style.left = `${(point.x / HEART_VIEWBOX.width) * 100}%`;
  heartToken.style.top = `${(point.y / HEART_VIEWBOX.height) * 100}%`;
}

function findClosestLengthOnPath(path, point) {
  const totalLength = path.getTotalLength();
  let bestLength = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let length = 0; length <= totalLength; length += 8) {
    const sample = path.getPointAtLength(length);
    const distance = getDistance(sample, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLength = length;
    }
  }

  let step = 4;
  while (step >= 0.5) {
    let localBestLength = bestLength;
    let localBestDistance = bestDistance;

    for (let length = Math.max(0, bestLength - step * 2); length <= Math.min(totalLength, bestLength + step * 2); length += step) {
      const sample = path.getPointAtLength(length);
      const distance = getDistance(sample, point);
      if (distance < localBestDistance) {
        localBestDistance = distance;
        localBestLength = length;
      }
    }

    bestLength = localBestLength;
    bestDistance = localBestDistance;
    step /= 2;
  }

  return { length: bestLength, distance: bestDistance };
}

function getDistance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function updateMusicUI() {
  const duration = roseSong.duration || 0;
  const currentTime = roseSong.currentTime || 0;

  musicCurrent.textContent = formatDuration(currentTime);
  musicDuration.textContent = formatDuration(duration);
  musicSeek.value = duration ? ((currentTime / duration) * 100).toFixed(1) : "0";
}

function handleSwipeStart(event) {
  if (event.target.closest("[data-no-swipe], button, textarea, input, select, video, .music-progress")) {
    state.swipeStart = null;
    return;
  }

  state.swipeStart = { x: event.clientX, y: event.clientY };
}

function handleSwipeEnd(event) {
  if (!state.swipeStart || state.isAnimating || state.storyEnded) {
    return;
  }

  const deltaX = event.clientX - state.swipeStart.x;
  const deltaY = event.clientY - state.swipeStart.y;
  state.swipeStart = null;

  if (Math.abs(deltaY) > 60 || Math.abs(deltaX) < 70) {
    return;
  }

  const visibleIndex = getVisiblePageIndex();

  if (deltaX < 0 && canAdvanceFromPageIndex(visibleIndex)) {
    goToPage(visibleIndex + 1);
  } else if (deltaX > 0) {
    goToPage(visibleIndex - 1);
  }
}

function autoresizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function applyImageFallback(img, primary, fallback) {
  img.addEventListener(
    "error",
    () => {
      img.src = fallback;
    },
    { once: true }
  );
  img.src = primary;
}

function resolveAsset(primary, fallback) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(primary);
    image.onerror = () => resolve(fallback);
    image.src = primary;
  });
}

function shuffle(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function ensureLiveNoteId() {
  const existing = sessionStorage.getItem(STORAGE_KEYS.liveNote);
  if (existing) {
    return existing;
  }

  const nextId = makeId("note");
  sessionStorage.setItem(STORAGE_KEYS.liveNote, nextId);
  return nextId;
}

function makeId(prefix) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString();
}

function formatClock(value) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
