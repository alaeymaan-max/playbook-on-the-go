/* ============================================
   PLAYBOOK — script.js
   Modular PDF Reader Application
============================================ */

'use strict';

// ─── PDF.js Worker ────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─── State ────────────────────────────────────────────────────────
const State = {
  pdfDoc:        null,
  currentFile:   null,
  totalPages:    0,
  currentPage:   1,
  scale:         1.3,
  library:       [],          // [{ id, name, dataUrl, pageCount, lastPage }]
  highlights:    {},          // { fileId: [{ id, page, rects, color, text, note }] }
  notes:         {},          // { fileId: string }
  bookmarks:     {},          // { fileId: [pageNum] }
  highlightMode: false,
  activeHighlight: null,
  searchMatches: [],
  searchIndex:   0,
  notesSaveTimer: null,
};

// ─── DOM Refs ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  splash:          $('splash-screen'),
  reader:          $('reader-screen'),
  uploadZone:      $('upload-zone'),
  fileInput:       $('file-input'),
  libraryGrid:     $('library-grid'),
  emptyLibrary:    $('empty-library'),
  btnClearAll:     $('btn-clear-all'),

  headerTitle:     $('header-doc-title'),
  btnBack:         $('btn-back'),
  btnSearchToggle: $('btn-search-toggle'),
  btnTocToggle:    $('btn-toc-toggle'),
  btnNotesToggle:  $('btn-notes-toggle'),

  searchBar:       $('search-bar'),
  searchInput:     $('search-input'),
  searchCount:     $('search-count'),
  btnSearchPrev:   $('btn-search-prev'),
  btnSearchNext:   $('btn-search-next'),
  btnSearchClose:  $('btn-search-close'),

  sidebarToc:      $('sidebar-toc'),
  sidebarNotes:    $('sidebar-notes'),
  btnTocClose:     $('btn-toc-close'),
  btnNotesClose:   $('btn-notes-close'),
  tocList:         $('toc-list'),
  thumbnailStrip:  $('thumbnail-strip'),

  pdfViewport:     $('pdf-viewport'),
  pdfContainer:    $('pdf-container'),
  loadingOverlay:  $('loading-overlay'),

  btnPrevPage:     $('btn-prev-page'),
  btnNextPage:     $('btn-next-page'),
  pageInput:       $('page-input'),
  pageTotal:       $('page-total'),
  btnZoomOut:      $('btn-zoom-out'),
  btnZoomIn:       $('btn-zoom-in'),
  zoomLabel:       $('zoom-label'),
  btnBookmark:     $('btn-bookmark'),
  bookmarkIcon:    $('bookmark-icon'),
  btnHighlightMode:$('btn-highlight-mode'),

  highlightMenu:   $('highlight-menu'),
  notePopup:       $('note-popup'),
  notePopupInput:  $('note-popup-input'),
  notePopupSave:   $('note-popup-save'),
  notePopupCancel: $('note-popup-cancel'),
  hlAddNote:       $('hl-add-note'),
  hlRemove:        $('hl-remove'),

  notesTextarea:   $('notes-textarea'),
  notesSaved:      $('notes-saved'),
  notesCharCount:  $('notes-char-count'),
  highlightsList:  $('highlights-list'),
  highlightsEmpty: $('highlights-empty'),
};

// ─── LocalStorage Helpers ─────────────────────────────────────────
const LS = {
  save(key, val) {
    try { localStorage.setItem('playbook_' + key, JSON.stringify(val)); } catch {}
  },
  load(key, fallback) {
    try {
      const v = localStorage.getItem('playbook_' + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  remove(key) {
    try { localStorage.removeItem('playbook_' + key); } catch {}
  }
};

// ─── Persistence ─────────────────────────────────────────────────
function persistAll() {
  const meta = State.library.map(({ id, name, pageCount, lastPage }) =>
    ({ id, name, pageCount, lastPage }));
  LS.save('library_meta', meta);
  LS.save('highlights', State.highlights);
  LS.save('notes', State.notes);
  LS.save('bookmarks', State.bookmarks);
}

function loadPersisted() {
  State.highlights = LS.load('highlights', {});
  State.notes      = LS.load('notes', {});
  State.bookmarks  = LS.load('bookmarks', {});
  const meta       = LS.load('library_meta', []);
  // Restore library cards (without PDF data — user must re-upload for reading)
  meta.forEach(m => {
    if (!State.library.find(x => x.id === m.id)) {
      State.library.push({ ...m, dataUrl: null });
    }
  });
}

// ─── Library ─────────────────────────────────────────────────────
function generateId(name) {
  return btoa(encodeURIComponent(name)).slice(0, 20) + '_' + Date.now();
}

function addToLibrary(file, dataUrl) {
  const id = generateId(file.name);
  const existing = State.library.find(x => x.name === file.name);
  if (existing) {
    existing.dataUrl = dataUrl;
    return existing.id;
  }
  const entry = { id, name: file.name, dataUrl, pageCount: 0, lastPage: 1 };
  State.library.unshift(entry);
  return id;
}

function renderLibrary() {
  dom.libraryGrid.innerHTML = '';
  if (State.library.length === 0) {
    dom.emptyLibrary.classList.add('show');
    return;
  }
  dom.emptyLibrary.classList.remove('show');

  State.library.forEach((entry, idx) => {
    const card = document.createElement('div');
    card.className = 'library-card';
    card.style.animationDelay = `${idx * 0.05}s`;

    const thumb = document.createElement('div');
    thumb.className = 'library-card-thumb';
    if (!entry.dataUrl) {
      thumb.innerHTML = `
        <div class="thumb-placeholder">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="2" width="18" height="24" rx="2" stroke="#5A5248" stroke-width="1.5"/>
            <line x1="8" y1="8" x2="18" y2="8" stroke="#5A5248" stroke-width="1.2" stroke-linecap="round"/>
            <line x1="8" y1="12" x2="18" y2="12" stroke="#5A5248" stroke-width="1.2" stroke-linecap="round"/>
            <line x1="8" y1="16" x2="14" y2="16" stroke="#5A5248" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <span style="font-size:0.65rem;color:var(--text-muted)">Re-upload to read</span>
        </div>`;
    } else {
      thumb.dataset.id = entry.id;
    }

    const title = document.createElement('div');
    title.className = 'library-card-title';
    title.textContent = entry.name.replace('.pdf', '');
    title.title = entry.name;

    const meta = document.createElement('div');
    meta.className = 'library-card-meta';
    meta.textContent = entry.pageCount
      ? `${entry.pageCount} pages  p.${entry.lastPage || 1}`
      : 'PDF';

    const del = document.createElement('button');
    del.className = 'library-card-delete';
    del.title = 'Remove';
    del.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    del.onclick = e => {
      e.stopPropagation();
      removeFromLibrary(entry.id);
    };

    card.append(thumb, title, meta, del);
    card.onclick = () => {
      if (!entry.dataUrl) {
        triggerUpload(entry);
      } else {
        openReader(entry);
      }
    };
    dom.libraryGrid.appendChild(card);

    // Render thumbnail from PDF data
    if (entry.dataUrl) {
      renderCardThumb(entry, thumb);
    }
  });
}

function renderCardThumb(entry, container) {
  pdfjsLib.getDocument({ url: entry.dataUrl }).promise.then(pdf => {
    return pdf.getPage(1).then(page => {
      const vp = page.getViewport({ scale: 0.4 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      container.innerHTML = '';
      container.appendChild(canvas);
      page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    });
  }).catch(() => {});
}

function removeFromLibrary(id) {
  State.library = State.library.filter(x => x.id !== id);
  delete State.highlights[id];
  delete State.notes[id];
  delete State.bookmarks[id];
  persistAll();
  LS.remove('pdf_' + id);
  renderLibrary();
}

function triggerUpload(targetEntry = null) {
  dom.fileInput.dataset.target = targetEntry ? targetEntry.id : '';
  dom.fileInput.click();
}

// ─── File Handling ────────────────────────────────────────────────
function handleFile(file, targetId = null) {
  if (!file || file.type !== 'application/pdf') {
    alert('Please upload a valid PDF file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    let entry;
    if (targetId) {
      entry = State.library.find(x => x.id === targetId);
      if (entry) entry.dataUrl = dataUrl;
    } else {
      const id = addToLibrary(file, dataUrl);
      entry = State.library.find(x => x.id === id);
    }
    LS.save('pdf_' + entry.id, dataUrl);
    persistAll();
    renderLibrary();
    openReader(entry);
  };
  reader.readAsDataURL(file);
}

// ─── Reader ───────────────────────────────────────────────────────
function showSplash() {
  dom.splash.classList.add('active');
  dom.reader.classList.remove('active');
  State.pdfDoc = null;
  State.currentFile = null;
}

function openReader(entry) {
  State.currentFile = entry;
  State.currentPage = entry.lastPage || 1;
  State.scale = 1.3;

  dom.splash.classList.remove('active');
  dom.reader.classList.add('active');
  dom.headerTitle.textContent = entry.name.replace('.pdf', '');
  dom.loadingOverlay.classList.remove('hidden');
  dom.pdfContainer.innerHTML = '';
  dom.thumbnailStrip.innerHTML = '';
  dom.tocList.innerHTML = '<p class="toc-empty">Loading...</p>';
  dom.loadingOverlay.style.display = 'flex';

  // Load notes
  dom.notesTextarea.value = State.notes[entry.id] || '';
  updateNotesChar();

  // Load stored PDF data
  const dataUrl = entry.dataUrl || LS.load('pdf_' + entry.id, null);
  if (!dataUrl) { showSplash(); return; }
  if (!entry.dataUrl) entry.dataUrl = dataUrl;

  pdfjsLib.getDocument({ url: dataUrl }).promise.then(pdf => {
    State.pdfDoc = pdf;
    State.totalPages = pdf.numPages;

    // Update library entry
    entry.pageCount = pdf.numPages;
    persistAll();

    dom.pageTotal.textContent = pdf.numPages;
    dom.loadingOverlay.style.display = 'none';

    renderAllPages();
    renderTOC();
    renderThumbnails();
    renderHighlightsList();
    updateBookmarkIcon();
    scrollToPage(State.currentPage);
  }).catch(err => {
    console.error(err);
    dom.loadingOverlay.querySelector('p').textContent = 'Failed to load PDF.';
  });
}

// ─── Page Rendering ───────────────────────────────────────────────
function renderAllPages() {
  dom.pdfContainer.innerHTML = '';
  for (let i = 1; i <= State.totalPages; i++) {
    renderPage(i);
  }
}

function renderPage(pageNum) {
  State.pdfDoc.getPage(pageNum).then(page => {
    const vp = page.getViewport({ scale: State.scale });

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';
    wrapper.dataset.page = pageNum;
    wrapper.style.width = vp.width + 'px';

    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width = vp.width + 'px';
    textLayerDiv.style.height = vp.height + 'px';

    const hlLayerDiv = document.createElement('div');
    hlLayerDiv.className = 'highlightLayer';
    hlLayerDiv.style.width = vp.width + 'px';
    hlLayerDiv.style.height = vp.height + 'px';
    hlLayerDiv.dataset.page = pageNum;

    const label = document.createElement('div');
    label.className = 'pdf-page-number';
    label.textContent = pageNum;

    wrapper.append(canvas, textLayerDiv, hlLayerDiv, label);
    dom.pdfContainer.appendChild(wrapper);

    // Render canvas
    page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });

    // Render text layer
    page.getTextContent().then(textContent => {
      pdfjsLib.renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport: vp,
        textDivs: [],
      });
    });

    // Render highlights
    renderPageHighlights(pageNum, hlLayerDiv, vp);
  });
}

function rerenderAllPages() {
  const wrappers = dom.pdfContainer.querySelectorAll('.pdf-page-wrapper');
  wrappers.forEach(w => {
    const pageNum = parseInt(w.dataset.page);
    w.remove();
  });
  renderAllPages();
}

// ─── Thumbnails ───────────────────────────────────────────────────
function renderThumbnails() {
  dom.thumbnailStrip.innerHTML = '';
  for (let i = 1; i <= Math.min(State.totalPages, 50); i++) {
    renderThumb(i);
  }
}

function renderThumb(pageNum) {
  State.pdfDoc.getPage(pageNum).then(page => {
    const vp = page.getViewport({ scale: 0.18 });
    const item = document.createElement('div');
    item.className = 'thumb-item';
    item.dataset.page = pageNum;
    if (pageNum === State.currentPage) item.classList.add('active');

    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;

    const lbl = document.createElement('div');
    lbl.className = 'thumb-label';
    lbl.textContent = pageNum;

    item.append(canvas, lbl);
    item.onclick = () => scrollToPage(pageNum);
    dom.thumbnailStrip.appendChild(item);

    page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  });
}

function updateThumbActive(pageNum) {
  dom.thumbnailStrip.querySelectorAll('.thumb-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.page) === pageNum);
  });
}

// ─── TOC ──────────────────────────────────────────────────────────
function renderTOC() {
  State.pdfDoc.getOutline().then(outline => {
    dom.tocList.innerHTML = '';
    if (!outline || outline.length === 0) {
      dom.tocList.innerHTML = '<p class="toc-empty">No outline available for this PDF.</p>';
      return;
    }
    const renderItems = (items, depth = 0) => {
      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'toc-item';
        div.style.paddingLeft = (10 + depth * 14) + 'px';
        div.textContent = item.title;
        div.onclick = () => {
          if (item.dest) {
            State.pdfDoc.getPageIndex(item.dest[0]).then(idx => {
              scrollToPage(idx + 1);
            }).catch(() => {});
          }
        };
        dom.tocList.appendChild(div);
        if (item.items && item.items.length > 0) renderItems(item.items, depth + 1);
      });
    };
    renderItems(outline);
  }).catch(() => {
    dom.tocList.innerHTML = '<p class="toc-empty">No outline available for this PDF.</p>';
  });
}

// ─── Navigation ───────────────────────────────────────────────────
function scrollToPage(pageNum) {
  pageNum = Math.max(1, Math.min(State.totalPages, pageNum));
  State.currentPage = pageNum;
  dom.pageInput.value = pageNum;
  updateThumbActive(pageNum);
  updateBookmarkIcon();

  const wrapper = dom.pdfContainer.querySelector(`[data-page="${pageNum}"]`);
  if (wrapper) {
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (State.currentFile) {
    State.currentFile.lastPage = pageNum;
    persistAll();
  }
}

function setupScrollObserver() {
  const observer = new IntersectionObserver((entries) => {
    let maxRatio = 0, topPage = State.currentPage;
    entries.forEach(e => {
      if (e.intersectionRatio > maxRatio) {
        maxRatio = e.intersectionRatio;
        topPage = parseInt(e.target.dataset.page);
      }
    });
    if (maxRatio > 0.3 && topPage !== State.currentPage) {
      State.currentPage = topPage;
      dom.pageInput.value = topPage;
      updateThumbActive(topPage);
      updateBookmarkIcon();
      if (State.currentFile) {
        State.currentFile.lastPage = topPage;
        persistAll();
      }
    }
  }, {
    root: dom.pdfViewport,
    threshold: [0, 0.3, 0.6, 1],
  });

  // Observe when pages are added
  const mo = new MutationObserver(() => {
    dom.pdfContainer.querySelectorAll('.pdf-page-wrapper').forEach(el => {
      observer.observe(el);
    });
  });
  mo.observe(dom.pdfContainer, { childList: true });
}

// ─── Zoom ─────────────────────────────────────────────────────────
function setZoom(newScale) {
  newScale = Math.max(0.5, Math.min(3.5, newScale));
  State.scale = newScale;
  dom.zoomLabel.textContent = Math.round(newScale * 100 / 1.3 * 100) + '%';
  rerenderAllPages();
}

// ─── Bookmarks ────────────────────────────────────────────────────
function updateBookmarkIcon() {
  if (!State.currentFile) return;
  const bm = State.bookmarks[State.currentFile.id] || [];
  const isBookmarked = bm.includes(State.currentPage);
  dom.bookmarkIcon.style.fill = isBookmarked ? 'var(--gold)' : 'none';
  dom.bookmarkIcon.style.stroke = isBookmarked ? 'var(--gold)' : 'currentColor';
}

function toggleBookmark() {
  if (!State.currentFile) return;
  const id = State.currentFile.id;
  if (!State.bookmarks[id]) State.bookmarks[id] = [];
  const idx = State.bookmarks[id].indexOf(State.currentPage);
  if (idx === -1) {
    State.bookmarks[id].push(State.currentPage);
  } else {
    State.bookmarks[id].splice(idx, 1);
  }
  persistAll();
  updateBookmarkIcon();
}

// ─── Highlights ───────────────────────────────────────────────────
function renderPageHighlights(pageNum, container, vp) {
  if (!State.currentFile) return;
  const hlList = State.highlights[State.currentFile.id] || [];
  hlList.filter(h => h.page === pageNum).forEach(h => {
    drawHighlightRect(h, container, vp);
  });
}

function drawHighlightRect(h, container, vp) {
  h.rects.forEach((r, ri) => {
    const div = document.createElement('div');
    div.className = 'highlight-rect';
    div.dataset.hlId = h.id;
    div.dataset.rectIdx = ri;
    div.style.cssText = `
      left: ${r.x * State.scale}px;
      top: ${r.y * State.scale}px;
      width: ${r.w * State.scale}px;
      height: ${r.h * State.scale}px;
      background: ${colorToRgba(h.color)};
    `;
    div.onclick = e => {
      e.stopPropagation();
      State.activeHighlight = h;
      showHighlightMenu(e.clientX, e.clientY, true);
    };
    container.appendChild(div);
  });
}

function colorToRgba(hex) {
  const map = {
    '#F5C842': 'rgba(245,200,66,0.32)',
    '#4CAF82': 'rgba(76,175,130,0.30)',
    '#4C8EAF': 'rgba(76,142,175,0.30)',
    '#AF4C4C': 'rgba(175,76,76,0.30)',
  };
  return map[hex] || 'rgba(201,168,76,0.30)';
}

function showHighlightMenu(x, y, isExisting = false) {
  dom.highlightMenu.classList.add('show');
  dom.hlAddNote.style.display = isExisting ? 'block' : 'block';
  dom.hlRemove.style.display = isExisting ? 'block' : 'none';

  let left = x, top = y - 52;
  if (left < 80) left = 80;
  if (top < 10) top = y + 12;

  dom.highlightMenu.style.left = left + 'px';
  dom.highlightMenu.style.top  = top + 'px';
}

function hideHighlightMenu() {
  dom.highlightMenu.classList.remove('show');
}

function applyHighlight(color) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) { hideHighlightMenu(); return; }

  const range = selection.getRangeAt(0);
  const wrapper = dom.pdfContainer.querySelector(`[data-page="${State.currentPage}"]`);
  if (!wrapper) { hideHighlightMenu(); return; }

  const hlLayer = wrapper.querySelector('.highlightLayer');
  const wrapperRect = wrapper.getBoundingClientRect();
  const clientRects = Array.from(range.getClientRects());

  const rects = clientRects.map(cr => ({
    x: (cr.left - wrapperRect.left) / State.scale,
    y: (cr.top  - wrapperRect.top)  / State.scale,
    w: cr.width  / State.scale,
    h: cr.height / State.scale,
  })).filter(r => r.w > 1 && r.h > 1);

  if (rects.length === 0) { hideHighlightMenu(); return; }

  const h = {
    id:    'hl_' + Date.now(),
    page:  State.currentPage,
    rects,
    color,
    text:  selection.toString().slice(0, 200),
    note:  '',
  };

  if (!State.highlights[State.currentFile.id]) State.highlights[State.currentFile.id] = [];
  State.highlights[State.currentFile.id].push(h);
  persistAll();

  const vp = { width: wrapperRect.width, height: wrapperRect.height };
  drawHighlightRect(h, hlLayer, vp);

  selection.removeAllRanges();
  hideHighlightMenu();
  renderHighlightsList();
}

function removeHighlight(h) {
  if (!State.currentFile) return;
  State.highlights[State.currentFile.id] =
    (State.highlights[State.currentFile.id] || []).filter(x => x.id !== h.id);
  persistAll();
  dom.pdfContainer.querySelectorAll(`[data-hl-id="${h.id}"]`).forEach(el => el.remove());
  renderHighlightsList();
}

function renderHighlightsList() {
  if (!State.currentFile) return;
  const list = State.highlights[State.currentFile.id] || [];
  dom.highlightsList.innerHTML = '';
  if (list.length === 0) {
    dom.highlightsEmpty.style.display = 'block';
    dom.highlightsList.appendChild(dom.highlightsEmpty);
    return;
  }
  dom.highlightsEmpty.style.display = 'none';
  list.forEach(h => {
    const card = document.createElement('div');
    card.className = 'highlight-card';
    card.style.borderLeftColor = h.color;

    const pg = document.createElement('div');
    pg.className = 'hc-page';
    pg.textContent = 'Page ' + h.page;

    const txt = document.createElement('div');
    txt.textContent = h.text || '(No text)';

    const del = document.createElement('button');
    del.className = 'hc-delete';
    del.title = 'Delete';
    del.textContent = 'x';
    del.onclick = e => { e.stopPropagation(); removeHighlight(h); };

    card.append(pg, txt, del);

    if (h.note) {
      const noteDiv = document.createElement('div');
      noteDiv.className = 'hc-note';
      noteDiv.textContent = h.note;
      card.appendChild(noteDiv);
    }

    card.onclick = () => scrollToPage(h.page);
    dom.highlightsList.appendChild(card);
  });
}

// ─── Search ───────────────────────────────────────────────────────
async function performSearch(query) {
  dom.pdfContainer.querySelectorAll('.search-mark').forEach(el => el.remove());
  State.searchMatches = [];
  State.searchIndex = 0;
  dom.searchCount.textContent = '';

  if (!query || !State.pdfDoc) return;

  const q = query.toLowerCase();
  for (let i = 1; i <= State.totalPages; i++) {
    const page = await State.pdfDoc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map(it => it.str).join(' ');
    if (text.toLowerCase().includes(q)) {
      State.searchMatches.push(i);
    }
  }
  dom.searchCount.textContent =
    State.searchMatches.length ? `${State.searchMatches.length} matches` : 'No results';

  if (State.searchMatches.length) {
    scrollToPage(State.searchMatches[0]);
  }
}

function searchNav(dir) {
  if (!State.searchMatches.length) return;
  State.searchIndex = (State.searchIndex + dir + State.searchMatches.length) % State.searchMatches.length;
  scrollToPage(State.searchMatches[State.searchIndex]);
}

// ─── Notes ────────────────────────────────────────────────────────
function updateNotesChar() {
  const len = dom.notesTextarea.value.length;
  dom.notesCharCount.textContent = len + ' chars';
}

function saveNotes() {
  if (!State.currentFile) return;
  State.notes[State.currentFile.id] = dom.notesTextarea.value;
  dom.notesSaved.textContent = 'Saved';
  dom.notesSaved.style.color = 'var(--gold-dim)';
  persistAll();
  setTimeout(() => {
    dom.notesSaved.textContent = '';
  }, 2000);
}

// ─── Note Popup ───────────────────────────────────────────────────
function showNotePopup(x, y) {
  dom.notePopup.classList.add('show');
  dom.notePopupInput.value = State.activeHighlight?.note || '';
  let left = x - 140, top = y - 200;
  if (left < 10) left = 10;
  if (top < 10) top = y + 10;
  dom.notePopup.style.left = left + 'px';
  dom.notePopup.style.top  = top + 'px';
  setTimeout(() => dom.notePopupInput.focus(), 50);
}

function hideNotePopup() {
  dom.notePopup.classList.remove('show');
}

// ─── Sidebar Toggle ───────────────────────────────────────────────
let tocOpen = false, notesOpen = false;

function toggleToc() {
  tocOpen = !tocOpen;
  if (window.innerWidth <= 768) {
    dom.sidebarToc.classList.toggle('open', tocOpen);
  } else {
    dom.sidebarToc.classList.toggle('closed', !tocOpen);
  }
  dom.btnTocToggle.classList.toggle('active', tocOpen);
}

function toggleNotes() {
  notesOpen = !notesOpen;
  if (window.innerWidth <= 768) {
    dom.sidebarNotes.classList.toggle('open', notesOpen);
  } else {
    dom.sidebarNotes.classList.toggle('closed', !notesOpen);
  }
  dom.btnNotesToggle.classList.toggle('active', notesOpen);
}

// ─── Event Bindings ───────────────────────────────────────────────
function bindEvents() {

  // Upload zone
  dom.uploadZone.addEventListener('click', () => triggerUpload());
  dom.uploadZone.addEventListener('dragover', e => {
    e.preventDefault(); dom.uploadZone.classList.add('drag-over');
  });
  dom.uploadZone.addEventListener('dragleave', () => {
    dom.uploadZone.classList.remove('drag-over');
  });
  dom.uploadZone.addEventListener('drop', e => {
    e.preventDefault(); dom.uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  dom.fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    const targetId = dom.fileInput.dataset.target || null;
    if (file) handleFile(file, targetId || null);
    dom.fileInput.value = '';
  });

  // Clear all
  dom.btnClearAll.addEventListener('click', () => {
    if (!confirm('Remove all PDFs from library?')) return;
    State.library = [];
    State.highlights = {};
    State.notes = {};
    State.bookmarks = {};
    persistAll();
    renderLibrary();
  });

  // Back
  dom.btnBack.addEventListener('click', () => {
    saveNotes();
    showSplash();
    renderLibrary();
  });

  // Sidebar toggles
  dom.btnTocToggle.addEventListener('click', toggleToc);
  dom.btnTocClose.addEventListener('click', toggleToc);
  dom.btnNotesToggle.addEventListener('click', toggleNotes);
  dom.btnNotesClose.addEventListener('click', toggleNotes);

  // Search
  dom.btnSearchToggle.addEventListener('click', () => {
    dom.searchBar.classList.toggle('open');
    if (dom.searchBar.classList.contains('open')) dom.searchInput.focus();
  });
  dom.btnSearchClose.addEventListener('click', () => {
    dom.searchBar.classList.remove('open');
    dom.searchInput.value = '';
    dom.searchCount.textContent = '';
    State.searchMatches = [];
  });
  let searchTimer;
  dom.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(dom.searchInput.value.trim()), 400);
  });
  dom.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchNav(1);
  });
  dom.btnSearchPrev.addEventListener('click', () => searchNav(-1));
  dom.btnSearchNext.addEventListener('click', () => searchNav(1));

  // Navigation
  dom.btnPrevPage.addEventListener('click', () => scrollToPage(State.currentPage - 1));
  dom.btnNextPage.addEventListener('click', () => scrollToPage(State.currentPage + 1));
  dom.pageInput.addEventListener('change', () => {
    const p = parseInt(dom.pageInput.value);
    if (!isNaN(p)) scrollToPage(p);
  });
  dom.pageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') dom.pageInput.blur();
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!dom.reader.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown')
      scrollToPage(State.currentPage + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp')
      scrollToPage(State.currentPage - 1);
    if (e.key === 'Home') scrollToPage(1);
    if (e.key === 'End') scrollToPage(State.totalPages);
    if (e.key === '+' || e.key === '=') setZoom(State.scale + 0.15);
    if (e.key === '-') setZoom(State.scale - 0.15);
    if (e.key === 'Escape') hideHighlightMenu();
  });

  // Zoom
  dom.btnZoomIn.addEventListener('click', () => setZoom(State.scale + 0.15));
  dom.btnZoomOut.addEventListener('click', () => setZoom(State.scale - 0.15));

  // Bookmark
  dom.btnBookmark.addEventListener('click', toggleBookmark);

  // Highlight mode
  dom.btnHighlightMode.addEventListener('click', () => {
    State.highlightMode = !State.highlightMode;
    dom.btnHighlightMode.classList.toggle('active', State.highlightMode);
    dom.pdfViewport.style.userSelect = State.highlightMode ? 'text' : '';
    dom.pdfViewport.style.cursor = State.highlightMode ? 'text' : '';
  });

  // Text selection highlight
  dom.pdfViewport.addEventListener('mouseup', e => {
    if (!State.highlightMode) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    showHighlightMenu(e.clientX, e.clientY, false);
  });

  // Highlight menu color buttons
  dom.highlightMenu.querySelectorAll('.hl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (State.activeHighlight) {
        State.activeHighlight.color = btn.dataset.color;
        persistAll();
        rerenderAllPages();
        renderHighlightsList();
        hideHighlightMenu();
        State.activeHighlight = null;
      } else {
        applyHighlight(btn.dataset.color);
      }
    });
  });

  dom.hlAddNote.addEventListener('click', () => {
    hideHighlightMenu();
    showNotePopup(
      parseInt(dom.highlightMenu.style.left),
      parseInt(dom.highlightMenu.style.top)
    );
  });

  dom.hlRemove.addEventListener('click', () => {
    if (State.activeHighlight) {
      removeHighlight(State.activeHighlight);
      State.activeHighlight = null;
    }
    hideHighlightMenu();
  });

  dom.notePopupSave.addEventListener('click', () => {
    if (State.activeHighlight) {
      State.activeHighlight.note = dom.notePopupInput.value.trim();
      persistAll();
      renderHighlightsList();
    }
    hideNotePopup();
    State.activeHighlight = null;
  });

  dom.notePopupCancel.addEventListener('click', () => {
    hideNotePopup();
    State.activeHighlight = null;
  });

  // Hide menus on outside click
  document.addEventListener('click', e => {
    if (!dom.highlightMenu.contains(e.target) &&
        !e.target.classList.contains('highlight-rect')) {
      hideHighlightMenu();
      if (!dom.notePopup.contains(e.target)) {
        State.activeHighlight = null;
      }
    }
    if (!dom.notePopup.contains(e.target) &&
        !dom.highlightMenu.contains(e.target) &&
        !e.target.classList.contains('highlight-rect')) {
      hideNotePopup();
    }
  });

  // Notes autosave
  dom.notesTextarea.addEventListener('input', () => {
    updateNotesChar();
    dom.notesSaved.textContent = 'Unsaved...';
    dom.notesSaved.style.color = 'var(--text-muted)';
    clearTimeout(State.notesSaveTimer);
    State.notesSaveTimer = setTimeout(saveNotes, 1200);
  });

  // Touch swipe for mobile page navigation
  let touchStartX = 0;
  dom.pdfViewport.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  dom.pdfViewport.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 60) {
      scrollToPage(State.currentPage + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });
}

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  // Default sidebar state
  dom.sidebarToc.classList.add('closed');
  dom.sidebarNotes.classList.add('closed');

  loadPersisted();

  // Try to restore PDF data from localStorage
  State.library.forEach(entry => {
    if (!entry.dataUrl) {
      const stored = LS.load('pdf_' + entry.id, null);
      if (stored) entry.dataUrl = stored;
    }
  });

  renderLibrary();
  bindEvents();
  setupScrollObserver();

  // Update zoom label initial
  dom.zoomLabel.textContent = '100%';
}

document.addEventListener('DOMContentLoaded', init);
