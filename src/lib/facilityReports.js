/**
 * Facility Reporting & Maintenance Module
 * Enables users to report broken facilities, snap photos via live camera or file input,
 * and track facility issues with persistent storage.
 */

const STORAGE_KEY = 'fcsit_facility_reports_v1';
const USER_INFO_KEY = 'fcsit_reporter_info_v1';
const DEVICE_KEY = 'fcsit_device_id_v1';
const ROLE_KEY = 'fcsit_user_role_v1';

/**
 * Get or generate a persistent unique device ID for this client/browser
 */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch (e) {}
  }
  return id;
}

/**
 * Get the current user role: 'admin' (default) or 'user'
 */
export function getUserRole() {
  const role = localStorage.getItem(ROLE_KEY);
  if (!role) {
    try {
      localStorage.setItem(ROLE_KEY, 'admin');
    } catch (e) {}
    return 'admin';
  }
  return role === 'user' ? 'user' : 'admin';
}

export function setUserRole(role) {
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch (e) {}
}

// Preset sample photos for demo seed data (self-contained SVG data URIs)
const DEMO_PROJECTOR_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="%231e293b"/><rect x="80" y="80" width="440" height="180" rx="16" fill="%23334155" stroke="%23475569" stroke-width="4"/><circle cx="420" cy="170" r="50" fill="%230f172a" stroke="%2364748b" stroke-width="8"/><circle cx="420" cy="170" r="32" fill="%231e293b"/><circle cx="150" cy="140" r="10" fill="%23ef4444"/><text x="170" y="145" fill="%23ef4444" font-family="sans-serif" font-size="14" font-weight="bold">LAMP FAILURE</text><circle cx="150" cy="180" r="10" fill="%23eab308"/><text x="170" y="185" fill="%23eab308" font-family="sans-serif" font-size="14">TEMP WARNING</text><rect x="60" y="300" width="480" height="60" rx="8" fill="%230f172a"/><text x="300" y="338" text-anchor="middle" fill="%23f8fafc" font-family="sans-serif" font-size="16" font-weight="bold">Dewan Kuliah 1 · Main Projector Broken</text></svg>`;

const DEMO_AC_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="%230f172a"/><rect x="100" y="60" width="400" height="150" rx="8" fill="%23f8fafc" stroke="%23cbd5e1" stroke-width="3"/><line x1="130" y1="130" x2="470" y2="130" stroke="%2394a3b8" stroke-width="3"/><line x1="130" y1="150" x2="470" y2="150" stroke="%2394a3b8" stroke-width="3"/><line x1="130" y1="170" x2="470" y2="170" stroke="%2394a3b8" stroke-width="3"/><path d="M260 220 C260 220 250 250 250 260 A10 10 0 0 0 270 260 C270 250 260 220 260 220 Z" fill="%2338bdf8"/><path d="M340 220 C340 220 330 270 330 280 A10 10 0 0 0 350 280 C350 270 340 220 340 220 Z" fill="%2338bdf8"/><ellipse cx="300" cy="350" rx="140" ry="24" fill="%230284c7" opacity="0.45"/><text x="300" y="356" text-anchor="middle" fill="%23e0f2fe" font-family="sans-serif" font-size="15" font-weight="bold">Makmal CCNA · AC Dripping Water</text></svg>`;

/**
 * Seed initial realistic demo reports if none exist
 */
function getInitialReports() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((r, i) => ({
          ...r,
          deviceId: r.deviceId || (i === 0 ? 'demo-system-1' : 'demo-system-2'),
        }));
      }
    } catch (e) {
      console.warn('Failed to parse saved facility reports', e);
    }
  }

  const defaultReports = [
    {
      id: 'FAC-2026-8491',
      deviceId: 'demo-system-1',
      roomCode: 'DK-01',
      roomName: 'Dewan Kuliah 1',
      buildingName: 'Block A',
      levelName: 'Level 1',
      category: 'teaching',
      facilityType: 'Projector / Screen',
      facilityIcon: '📽️',
      description: 'Main lecture projector bulb has burned out and turns off after 2 minutes. HDMI cable socket is also loose.',
      urgency: 'Urgent',
      photo: DEMO_PROJECTOR_SVG,
      reporterName: 'Dr. Siti (Lecturer)',
      reporterContact: 'siti@fcsit.edu.my',
      timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      status: 'In Progress',
    },
    {
      id: 'FAC-2026-7215',
      deviceId: 'demo-system-2',
      roomCode: 'MP-01',
      roomName: 'Makmal CCNA',
      buildingName: 'Block A',
      levelName: 'Level 1',
      category: 'lab',
      facilityType: 'Air Conditioner',
      facilityIcon: '❄️',
      description: 'Ceiling cassette AC unit #2 is leaking condensation water directly onto student desks at row 3.',
      urgency: 'Medium',
      photo: DEMO_AC_SVG,
      reporterName: 'Irfan (Student)',
      reporterContact: 'irfan.std@siswa.edu.my',
      timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      status: 'Pending Review',
    },
  ];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultReports));
  } catch (e) {}

  return defaultReports;
}

export function createFacilityReportManager({ campus, onSelectRoom, showToast }) {
  let reports = getInitialReports();
  let currentSelectedRoom = null;
  let activeCameraStream = null;
  let currentFacingMode = 'environment';
  let snappedPhotoData = null;
  let activeFilter = 'all';
  let userRole = getUserRole(); // Defaults to 'admin' as requested

  // Role & Admin Auth elements
  const roleBadge = document.getElementById('reports-role-badge');
  const roleIcon = document.getElementById('reports-role-icon');
  const roleBadgeText = document.getElementById('reports-role-badge-text');
  const reportsListTitle = document.getElementById('reports-list-title');
  const reportsListSubtitle = document.getElementById('reports-list-subtitle');
  const btnToggleRole = document.getElementById('btn-toggle-role');
  const roleSwitchIcon = document.getElementById('role-switch-icon');
  const roleSwitchText = document.getElementById('role-switch-text');

  const adminAuthModal = document.getElementById('admin-auth-modal');
  const adminAuthBackdrop = document.getElementById('admin-auth-backdrop');
  const adminAuthForm = document.getElementById('admin-auth-form');
  const adminPasscodeInput = document.getElementById('admin-passcode-input');
  const adminAuthError = document.getElementById('admin-auth-error');
  const adminAuthCancel = document.getElementById('admin-auth-cancel');

  // Modal elements
  const reportModal = document.getElementById('facility-report-modal');
  const reportForm = document.getElementById('facility-report-form');
  const locationCard = document.getElementById('report-location-card');
  const locationNameEl = document.getElementById('report-location-name');
  const locationMetaEl = document.getElementById('report-location-meta');
  const locationSearchWrap = document.getElementById('report-location-search-wrap');
  const locationChangeBtn = document.getElementById('report-location-change-btn');
  const searchInput = document.getElementById('report-search-input');
  const searchResults = document.getElementById('report-search-results');
  const searchClearBtn = document.getElementById('report-search-clear');
  const formErrorEl = document.getElementById('report-form-error');

  // Camera elements
  const cameraLiveBox = document.getElementById('camera-live-box');
  const cameraVideo = document.getElementById('camera-live-video');
  const cameraShutterBtn = document.getElementById('camera-shutter-btn');
  const cameraFlipBtn = document.getElementById('camera-flip-btn');
  const cameraCancelBtn = document.getElementById('camera-cancel-btn');
  const cameraFlash = document.getElementById('camera-flash');
  const btnStartCamera = document.getElementById('btn-start-camera');
  const photoFileInput = document.getElementById('report-photo-file');
  const photoCaptureActions = document.getElementById('photo-capture-actions');

  // Photo preview elements
  const photoPreviewCard = document.getElementById('photo-preview-card');
  const photoPreviewImg = document.getElementById('photo-preview-img');
  const photoPreviewTitle = document.getElementById('photo-preview-title');
  const photoPreviewMeta = document.getElementById('photo-preview-meta');
  const photoRetakeBtn = document.getElementById('photo-retake-btn');
  const photoRemoveBtn = document.getElementById('photo-remove-btn');
  const photoPreviewZoom = document.getElementById('photo-preview-zoom');

  // Success modal elements
  const successModal = document.getElementById('facility-report-success-modal');
  const successTicketId = document.getElementById('success-ticket-id');
  const successSummaryBox = document.getElementById('success-summary-box');

  // Reports list modal elements
  const reportsListModal = document.getElementById('facility-reports-list-modal');
  const reportsListBody = document.getElementById('reports-list-body');
  const filterTabs = document.getElementById('reports-filter-tabs');

  // Search index for in-modal room search
  const roomSearchIndex = campus.rooms.map((room) => ({
    room,
    haystack: `${room.name} ${room.code ?? ''} ${room.note ?? ''} ${room.building.name} ${room.level.name}`.toLowerCase(),
  }));

  function saveReports() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    } catch (e) {
      console.warn('Could not save reports to localStorage', e);
    }
    updateHudBadge();
  }

  function getReportsForRoom(room) {
    if (!room) return [];
    return reports.filter((r) => {
      if (room.code && r.roomCode && r.roomCode.toLowerCase() === room.code.toLowerCase()) return true;
      if (r.roomName && room.name && r.roomName.toLowerCase() === room.name.toLowerCase()) return true;
      return false;
    });
  }

  function updateHudBadge() {
    const isAdmin = (userRole === 'admin');
    const myDeviceId = getDeviceId();
    // Admin sees all campus pending issues; regular user sees pending issues they reported
    const source = isAdmin ? reports : reports.filter((r) => r.deviceId === myDeviceId);
    const count = source.filter((r) => r.status !== 'Resolved').length;
    const badges = document.querySelectorAll('.reports-count-badge');
    badges.forEach((b) => {
      b.textContent = count;
      b.hidden = count === 0;
    });
  }

  // -------------------------------------------------- Room selection in report modal

  function setReportRoom(room) {
    currentSelectedRoom = room;
    if (room) {
      locationNameEl.textContent = room.code ? `${room.name} (${room.code})` : room.name;
      locationMetaEl.textContent = `${room.building.name} · ${room.level.name}`;
      locationCard.hidden = false;
      locationSearchWrap.hidden = true;
      if (formErrorEl) formErrorEl.hidden = true;
    } else {
      locationCard.hidden = true;
      locationSearchWrap.hidden = false;
      if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 80);
      }
    }
  }

  // In-modal location search handling
  function performModalSearch(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      searchResults.hidden = true;
      return;
    }
    const matches = roomSearchIndex
      .filter((entry) => entry.haystack.includes(query))
      .slice(0, 8);

    searchResults.replaceChildren();
    searchResults.hidden = false;

    if (!matches.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.innerHTML = `<span>No rooms found for "<strong>${escapeHtml(query)}</strong>"</span>`;
      searchResults.append(li);
      return;
    }

    for (const { room } of matches) {
      const li = document.createElement('li');
      const codePill = room.code ? `<span class="code-pill">${escapeHtml(room.code)}</span>` : '';
      li.innerHTML = `
        <span class="name">${escapeHtml(room.name)}</span>
        ${codePill}
        <span class="where">${escapeHtml(room.building.name)} · ${escapeHtml(room.level.name)}</span>
      `;
      li.addEventListener('click', () => {
        setReportRoom(room);
        searchResults.hidden = true;
        if (searchInput) searchInput.value = '';
      });
      searchResults.append(li);
    }
  }

  if (searchInput && searchResults) {
    searchInput.addEventListener('input', (e) => {
      performModalSearch(e.target.value);
      if (searchClearBtn) searchClearBtn.hidden = !e.target.value;
    });
    searchInput.addEventListener('focus', (e) => performModalSearch(e.target.value));
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchResults.hidden = true;
        searchClearBtn.hidden = true;
        searchInput.focus();
      });
    }
  }

  locationChangeBtn?.addEventListener('click', () => {
    locationSearchWrap.hidden = false;
    searchInput?.focus();
  });

  // -------------------------------------------------- Live Camera & Snap Implementation

  async function startLiveCamera() {
    stopLiveCamera();
    try {
      const constraints = {
        video: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera stream not supported by browser. Using file picker.');
        photoFileInput.click();
        return;
      }

      activeCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraVideo.srcObject = activeCameraStream;
      await cameraVideo.play();

      cameraLiveBox.hidden = false;
      photoCaptureActions.hidden = true;
      photoPreviewCard.hidden = true;
    } catch (err) {
      console.warn('Live camera access error:', err);
      showToast('Camera permission denied or not found. Please upload or take photo.');
      stopLiveCamera();
      photoFileInput.click();
    }
  }

  function stopLiveCamera() {
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach((track) => track.stop());
      activeCameraStream = null;
    }
    if (cameraVideo) {
      cameraVideo.srcObject = null;
    }
    if (cameraLiveBox) {
      cameraLiveBox.hidden = true;
    }
    if (photoCaptureActions && !snappedPhotoData) {
      photoCaptureActions.hidden = false;
    }
  }

  function snapPhotoFromLiveStream() {
    if (!cameraVideo || !activeCameraStream) return;

    // Trigger visual camera flash
    if (cameraFlash) {
      cameraFlash.classList.add('is-flashing');
      setTimeout(() => cameraFlash.classList.remove('is-flashing'), 280);
    }

    const canvas = document.createElement('canvas');
    const width = cameraVideo.videoWidth || 640;
    const height = cameraVideo.videoHeight || 480;

    // Scale down if image is overly huge to prevent localStorage quota exhaustion
    const maxDim = 1200;
    let targetW = width;
    let targetH = height;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        targetW = maxDim;
        targetH = Math.round((height / width) * maxDim);
      } else {
        targetH = maxDim;
        targetW = Math.round((width / height) * maxDim);
      }
    }

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setSnappedPhoto(dataUrl, 'Live Camera Snapshot');
    stopLiveCamera();
  }

  function setSnappedPhoto(dataUrl, sourceName = 'Camera Photo') {
    snappedPhotoData = dataUrl;
    if (photoPreviewImg) {
      photoPreviewImg.src = dataUrl;
    }
    if (photoPreviewTitle) {
      const facility = getSelectedFacilityType();
      photoPreviewTitle.textContent = `${facility.type} Photo`;
    }
    if (photoPreviewMeta) {
      const now = new Date();
      photoPreviewMeta.textContent = `Snapped ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Ready to submit`;
    }
    if (photoPreviewCard) {
      photoPreviewCard.hidden = false;
    }
    if (photoCaptureActions) {
      photoCaptureActions.hidden = true;
    }
    if (cameraLiveBox) {
      cameraLiveBox.hidden = true;
    }
    if (formErrorEl) formErrorEl.hidden = true;
  }

  function clearSnappedPhoto() {
    snappedPhotoData = null;
    if (photoPreviewCard) photoPreviewCard.hidden = true;
    if (photoCaptureActions) photoCaptureActions.hidden = false;
    if (photoFileInput) photoFileInput.value = '';
  }

  // File input capture (native smartphone camera trigger or file chooser)
  if (photoFileInput) {
    photoFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1200;
          let targetW = img.width;
          let targetH = img.height;
          if (img.width > maxDim || img.height > maxDim) {
            if (img.width > img.height) {
              targetW = maxDim;
              targetH = Math.round((img.height / img.width) * maxDim);
            } else {
              targetH = maxDim;
              targetW = Math.round((img.width / img.height) * maxDim);
            }
          }
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const compressedUrl = canvas.toDataURL('image/jpeg', 0.82);
          setSnappedPhoto(compressedUrl, file.name);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Camera button bindings
  btnStartCamera?.addEventListener('click', startLiveCamera);
  cameraShutterBtn?.addEventListener('click', snapPhotoFromLiveStream);
  cameraCancelBtn?.addEventListener('click', stopLiveCamera);
  cameraFlipBtn?.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startLiveCamera();
  });
  photoRetakeBtn?.addEventListener('click', () => {
    clearSnappedPhoto();
    startLiveCamera();
  });
  photoRemoveBtn?.addEventListener('click', clearSnappedPhoto);

  // Zoom preview photo
  photoPreviewZoom?.addEventListener('click', () => {
    if (snappedPhotoData) {
      openEnlargedPhoto(snappedPhotoData, 'Snapped Photo Preview', currentSelectedRoom?.name ?? 'Facility Issue');
    }
  });

  // -------------------------------------------------- Facility Type & Quick Tags

  const facilityGrid = document.getElementById('facility-type-grid');
  facilityGrid?.addEventListener('click', (e) => {
    const chip = e.target.closest('.facility-chip');
    if (!chip) return;
    facilityGrid.querySelectorAll('.facility-chip').forEach((c) => c.classList.remove('is-selected'));
    chip.classList.add('is-selected');

    if (photoPreviewTitle && snappedPhotoData) {
      photoPreviewTitle.textContent = `${chip.dataset.type} Photo`;
    }
  });

  function getSelectedFacilityType() {
    const selected = facilityGrid?.querySelector('.facility-chip.is-selected');
    if (selected) {
      return {
        type: selected.dataset.type,
        icon: selected.dataset.icon || '🔧',
      };
    }
    return { type: 'Other', icon: '📦' };
  }

  // Quick Tags
  const quickTags = document.getElementById('report-quick-tags');
  quickTags?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-chip');
    if (!btn) return;
    const descTextarea = document.getElementById('report-description');
    if (!descTextarea) return;
    const tagText = btn.dataset.text;
    if (descTextarea.value.trim()) {
      descTextarea.value += `, ${tagText}`;
    } else {
      descTextarea.value = tagText;
    }
    descTextarea.focus();
  });

  // -------------------------------------------------- Modal Open / Close

  function openReportModal(room = null) {
    if (!reportModal) return;
    stopLiveCamera();
    clearSnappedPhoto();

    // Reset error
    if (formErrorEl) {
      formErrorEl.hidden = true;
      formErrorEl.textContent = '';
    }

    // Prefill reporter info if remembered
    try {
      const savedUser = JSON.parse(localStorage.getItem(USER_INFO_KEY) || '{}');
      const nameInput = document.getElementById('report-reporter-name');
      const contactInput = document.getElementById('report-reporter-contact');
      if (nameInput && savedUser.name) nameInput.value = savedUser.name;
      if (contactInput && savedUser.contact) contactInput.value = savedUser.contact;
    } catch (e) {}

    // Reset description
    const descEl = document.getElementById('report-description');
    if (descEl) descEl.value = '';

    // Reset facility type to first one
    const chips = facilityGrid?.querySelectorAll('.facility-chip');
    chips?.forEach((c, idx) => c.classList.toggle('is-selected', idx === 0));

    // Reset urgency
    const defaultUrgency = document.querySelector('input[name="report-urgency"][value="Medium"]');
    if (defaultUrgency) defaultUrgency.checked = true;

    // Set room
    setReportRoom(room);

    reportModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeReportModal() {
    if (!reportModal) return;
    stopLiveCamera();
    reportModal.hidden = true;
    document.body.style.overflow = '';
  }

  document.getElementById('report-modal-close')?.addEventListener('click', closeReportModal);
  document.getElementById('report-modal-backdrop')?.addEventListener('click', closeReportModal);
  document.getElementById('report-cancel-btn')?.addEventListener('click', closeReportModal);

  // -------------------------------------------------- Form Submission

  reportForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!currentSelectedRoom) {
      if (formErrorEl) {
        formErrorEl.textContent = 'Please choose a room or location for the report.';
        formErrorEl.hidden = false;
      }
      locationSearchWrap.hidden = false;
      searchInput?.focus();
      return;
    }

    const descInput = document.getElementById('report-description');
    const description = descInput?.value.trim() ?? '';
    if (!description) {
      if (formErrorEl) {
        formErrorEl.textContent = 'Please provide a brief description of what is broken.';
        formErrorEl.hidden = false;
      }
      descInput?.focus();
      return;
    }

    const facility = getSelectedFacilityType();
    const urgency = document.querySelector('input[name="report-urgency"]:checked')?.value || 'Medium';
    const reporterName = document.getElementById('report-reporter-name')?.value.trim() || 'Anonymous';
    const reporterContact = document.getElementById('report-reporter-contact')?.value.trim() || '';

    // Remember reporter info
    if (reporterName !== 'Anonymous' || reporterContact) {
      try {
        localStorage.setItem(USER_INFO_KEY, JSON.stringify({ name: reporterName, contact: reporterContact }));
      } catch (err) {}
    }

    // Generate Ticket ID: FAC-YEAR-RANDOM
    const ticketId = `FAC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newReport = {
      id: ticketId,
      deviceId: getDeviceId(),
      roomCode: currentSelectedRoom.code || '',
      roomName: currentSelectedRoom.name,
      buildingName: currentSelectedRoom.building.name,
      levelName: currentSelectedRoom.level.name,
      category: currentSelectedRoom.category,
      facilityType: facility.type,
      facilityIcon: facility.icon,
      description,
      urgency,
      photo: snappedPhotoData || null,
      reporterName,
      reporterContact,
      timestamp: new Date().toISOString(),
      status: 'Pending Review',
    };

    // Prepend to reports
    reports.unshift(newReport);
    saveReports();

    // Close report modal and show celebratory success modal
    closeReportModal();
    openSuccessModal(newReport);
  });

  // -------------------------------------------------- Success Modal

  function openSuccessModal(report) {
    if (!successModal) return;

    if (successTicketId) successTicketId.textContent = `Ticket #${report.id}`;

    if (successSummaryBox) {
      const photoHtml = report.photo
        ? `<div class="success-photo-wrap"><img src="${report.photo}" alt="Report photo" /></div>`
        : `<div class="success-photo-placeholder">${report.facilityIcon}</div>`;

      successSummaryBox.innerHTML = `
        ${photoHtml}
        <div class="success-details">
          <div class="success-room">${escapeHtml(report.roomName)} ${report.roomCode ? `<span class="code-pill">${escapeHtml(report.roomCode)}</span>` : ''}</div>
          <div class="success-facility">${report.facilityIcon} <strong>${escapeHtml(report.facilityType)}</strong> · <span class="urgency-tag urgency-tag--${report.urgency.toLowerCase()}">${report.urgency}</span></div>
          <div class="success-desc">"${escapeHtml(report.description)}"</div>
        </div>
      `;
    }

    successModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSuccessModal() {
    if (successModal) successModal.hidden = true;
    document.body.style.overflow = '';
  }

  document.getElementById('success-close-btn')?.addEventListener('click', closeSuccessModal);
  document.getElementById('report-success-backdrop')?.addEventListener('click', closeSuccessModal);

  document.getElementById('success-view-map-btn')?.addEventListener('click', () => {
    closeSuccessModal();
    if (currentSelectedRoom && onSelectRoom) {
      onSelectRoom(currentSelectedRoom);
    }
  });

  document.getElementById('success-view-reports-btn')?.addEventListener('click', () => {
    closeSuccessModal();
    openReportsListModal();
  });

  // -------------------------------------------------- Reports List & Tracking Modal

  function openReportsListModal(filterRoom = null) {
    if (!reportsListModal) return;
    renderReportsList(filterRoom);
    reportsListModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeReportsListModal() {
    if (reportsListModal) reportsListModal.hidden = true;
    document.body.style.overflow = '';
  }

  document.getElementById('reports-list-close')?.addEventListener('click', closeReportsListModal);
  document.getElementById('reports-list-backdrop')?.addEventListener('click', closeReportsListModal);

  document.getElementById('btn-list-new-report')?.addEventListener('click', () => {
    closeReportsListModal();
    openReportModal(currentSelectedRoom);
  });

  // Helper to sync role indicator badge and modal titles
  function updateRoleHeaderUI() {
    const isAdmin = (userRole === 'admin');
    if (roleBadge) {
      roleBadge.className = `report-badge ${isAdmin ? 'is-admin' : 'is-user'}`;
    }
    if (roleIcon) {
      roleIcon.textContent = isAdmin ? '🛡️' : '👤';
    }
    if (roleBadgeText) {
      roleBadgeText.textContent = isAdmin ? 'Administrator View' : 'My Reports Only';
    }
    if (reportsListTitle) {
      reportsListTitle.textContent = isAdmin ? 'Facility Activity Log' : 'My Submitted Reports';
    }
    if (reportsListSubtitle) {
      reportsListSubtitle.textContent = isAdmin
        ? 'Master activity log · All campus reports & maintenance controls'
        : 'Regular User mode: Only showing reports submitted from this device';
    }
    if (roleSwitchIcon) {
      roleSwitchIcon.textContent = isAdmin ? '👤' : '🛡️';
    }
    if (roleSwitchText) {
      roleSwitchText.textContent = isAdmin ? 'Switch to User View' : 'Admin Access 🛡️';
    }
  }

  // Admin auth modal logic
  function openAdminAuthModal() {
    if (!adminAuthModal) return;
    adminAuthModal.hidden = false;
    if (adminAuthError) adminAuthError.hidden = true;
    if (adminPasscodeInput) {
      adminPasscodeInput.value = '';
      setTimeout(() => adminPasscodeInput.focus(), 80);
    }
  }

  function closeAdminAuthModal() {
    if (adminAuthModal) adminAuthModal.hidden = true;
  }

  adminAuthCancel?.addEventListener('click', closeAdminAuthModal);
  adminAuthBackdrop?.addEventListener('click', closeAdminAuthModal);

  adminAuthForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pass = adminPasscodeInput?.value.trim().toLowerCase();
    if (pass === 'admin' || pass === 'fcsit' || pass === 'admin123') {
      userRole = 'admin';
      setUserRole('admin');
      closeAdminAuthModal();
      updateRoleHeaderUI();
      updateHudBadge();
      renderReportsList();
      showToast('🛡️ Administrator verified: Master campus activity log unlocked');
    } else {
      if (adminAuthError) {
        adminAuthError.textContent = 'Invalid administrator passcode. Default: admin';
        adminAuthError.hidden = false;
      }
      adminPasscodeInput?.select();
    }
  });

  btnToggleRole?.addEventListener('click', () => {
    if (userRole === 'admin') {
      userRole = 'user';
      setUserRole('user');
      updateRoleHeaderUI();
      updateHudBadge();
      renderReportsList();
      showToast('👤 Switched to User View: Showing only your own reports');
    } else {
      openAdminAuthModal();
    }
  });

  filterTabs?.addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    filterTabs.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    activeFilter = tab.dataset.filter || 'all';
    renderReportsList();
  });

  function renderReportsList(filterRoom = null) {
    if (!reportsListBody) return;
    updateRoleHeaderUI();

    const isAdmin = (userRole === 'admin');
    const myDeviceId = getDeviceId();

    // Base collection according to role:
    // Administration: Can view entire report activity log across campus.
    // Regular users: Can ONLY view their own submitted reports.
    const accessibleReports = isAdmin
      ? reports
      : reports.filter((r) => r.deviceId === myDeviceId);

    // Update counts
    const countAll = accessibleReports.length;
    const countPending = accessibleReports.filter((r) => r.status !== 'Resolved').length;
    const countResolved = accessibleReports.filter((r) => r.status === 'Resolved').length;

    const elAll = document.getElementById('reports-count-all');
    const elPending = document.getElementById('reports-count-pending');
    const elResolved = document.getElementById('reports-count-resolved');
    if (elAll) elAll.textContent = countAll;
    if (elPending) elPending.textContent = countPending;
    if (elResolved) elResolved.textContent = countResolved;

    let filtered = accessibleReports;
    if (filterRoom) {
      filtered = accessibleReports.filter((r) => {
        if (filterRoom.code && r.roomCode && r.roomCode.toLowerCase() === filterRoom.code.toLowerCase()) return true;
        if (r.roomName && filterRoom.name && r.roomName.toLowerCase() === filterRoom.name.toLowerCase()) return true;
        return false;
      });
    } else if (activeFilter === 'pending') {
      filtered = accessibleReports.filter((r) => r.status !== 'Resolved');
    } else if (activeFilter === 'resolved') {
      filtered = accessibleReports.filter((r) => r.status === 'Resolved');
    }

    reportsListBody.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'reports-empty-state';
      if (!isAdmin) {
        empty.innerHTML = `
          <div class="reports-empty-icon">📋</div>
          <h3>No Reports Submitted</h3>
          <p>You haven't submitted any broken facility reports from this device yet${filterRoom ? ` for ${escapeHtml(filterRoom.name)}` : ''}.</p>
          <button type="button" class="btn-create-first-report" id="btn-create-empty-report">
            Snap Photo &amp; Report Issue
          </button>
        `;
      } else {
        empty.innerHTML = `
          <div class="reports-empty-icon">✨</div>
          <h3>No Reports in Log</h3>
          <p>Master activity log has no broken facilities recorded matching this filter${filterRoom ? ` for ${escapeHtml(filterRoom.name)}` : ''}.</p>
          <button type="button" class="btn-create-first-report" id="btn-create-empty-report">
            Snap Photo &amp; Report Issue
          </button>
        `;
      }
      empty.querySelector('#btn-create-empty-report')?.addEventListener('click', () => {
        closeReportsListModal();
        openReportModal(filterRoom || currentSelectedRoom);
      });
      reportsListBody.append(empty);
      return;
    }

    for (const r of filtered) {
      const card = document.createElement('div');
      card.className = `report-item-card ${r.status === 'Resolved' ? 'is-resolved' : ''}`;

      const dateStr = new Date(r.timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const photoThumbHtml = r.photo
        ? `<div class="report-item-thumb" title="Click to view enlarged photo" role="button" tabindex="0">
             <img src="${r.photo}" alt="${escapeHtml(r.facilityType)}" />
             <span class="thumb-badge">📷 Photo</span>
           </div>`
        : `<div class="report-item-thumb report-item-thumb--empty">
             <span class="report-item-icon">${r.facilityIcon || '⚠️'}</span>
           </div>`;

      const statusBadgeClass =
        r.status === 'Resolved'
          ? 'status-pill--resolved'
          : r.status === 'In Progress'
            ? 'status-pill--progress'
            : 'status-pill--pending';

      const reporterHtml = isAdmin
        ? `<span class="report-reporter">By: <strong>${escapeHtml(r.reporterName || 'Student/Staff')}</strong> ${r.reporterContact ? `· <span class="reporter-contact">📧 ${escapeHtml(r.reporterContact)}</span>` : ''}</span>`
        : `<span class="report-reporter">Submitted by you · <strong>${escapeHtml(r.reporterName || 'Me')}</strong></span>`;

      const adminActionsHtml = isAdmin
        ? `<button type="button" class="btn-item-toggle-status" title="Toggle between Pending and Resolved">
             ${r.status === 'Resolved' ? 'Re-open' : '✓ Mark Resolved'}
           </button>
           <button type="button" class="btn-item-delete" title="Delete this report">
             <svg class="ui-icon-xs"><use href="#icon-trash"></use></svg>
           </button>`
        : '';

      card.innerHTML = `
        <div class="report-item-header">
          <div class="report-item-location">
            <span class="report-item-tag">${escapeHtml(r.id)}</span>
            <strong class="report-item-room">${escapeHtml(r.roomName)}</strong>
            ${r.roomCode ? `<span class="code-pill">${escapeHtml(r.roomCode)}</span>` : ''}
            <span class="report-item-meta">${escapeHtml(r.buildingName)} · ${escapeHtml(r.levelName)}</span>
          </div>
          <div class="report-item-status-wrap">
            <span class="status-pill ${statusBadgeClass}">${escapeHtml(r.status)}</span>
          </div>
        </div>

        <div class="report-item-main">
          ${photoThumbHtml}
          <div class="report-item-content">
            <div class="report-item-type-row">
              <span class="report-type-badge">${r.facilityIcon || ''} ${escapeHtml(r.facilityType)}</span>
              <span class="urgency-tag urgency-tag--${r.urgency.toLowerCase()}">${escapeHtml(r.urgency)}</span>
              <span class="report-time">${dateStr}</span>
            </div>
            <p class="report-item-desc">${escapeHtml(r.description)}</p>
            <div class="report-item-footer">
              ${reporterHtml}
              <div class="report-item-actions">
                <button type="button" class="btn-item-locate" title="Highlight this room in 3D">
                  📍 Locate Room
                </button>
                ${adminActionsHtml}
              </div>
            </div>
          </div>
        </div>
      `;

      // Zoom photo
      card.querySelector('.report-item-thumb img')?.addEventListener('click', () => {
        openEnlargedPhoto(r.photo, `${r.facilityType} Issue Photo`, `${r.roomName} (${r.id})`);
      });

      // Locate room in 3D scene
      card.querySelector('.btn-item-locate')?.addEventListener('click', () => {
        closeReportsListModal();
        const matched = campus.rooms.find(
          (rm) => (rm.code && r.roomCode && rm.code.toLowerCase() === r.roomCode.toLowerCase()) ||
                  rm.name.toLowerCase() === r.roomName.toLowerCase()
        );
        if (matched && onSelectRoom) {
          onSelectRoom(matched);
        } else {
          showToast(`Located: ${r.roomName}`);
        }
      });

      // Toggle status (Admin only)
      card.querySelector('.btn-item-toggle-status')?.addEventListener('click', () => {
        r.status = r.status === 'Resolved' ? 'Pending Review' : 'Resolved';
        saveReports();
        renderReportsList(filterRoom);
        showToast(`Report ${r.id} marked as ${r.status}`);
      });

      // Delete report (Admin only)
      card.querySelector('.btn-item-delete')?.addEventListener('click', () => {
        reports = reports.filter((item) => item.id !== r.id);
        saveReports();
        renderReportsList(filterRoom);
        showToast(`Report ${r.id} deleted`);
      });

      reportsListBody.append(card);
    }
  }

  // Helper to enlarge photo in lightbox
  function openEnlargedPhoto(photoUrl, title, subtitle) {
    const lightbox = document.getElementById('photo-lightbox');
    const imgEl = document.getElementById('photo-lightbox-img');
    const titleEl = document.getElementById('photo-lightbox-title');
    const subtitleEl = document.getElementById('photo-lightbox-subtitle');
    const badgeEl = document.getElementById('photo-lightbox-badge');

    if (!lightbox || !imgEl) return;
    imgEl.src = photoUrl;
    imgEl.alt = title;
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
    if (badgeEl) {
      badgeEl.textContent = '📸 Facility Report Evidence';
      badgeEl.classList.remove('is-verified');
    }
    lightbox.hidden = false;
  }

  // Initial badge sync
  updateHudBadge();

  return {
    openReportModal,
    openReportsListModal,
    getReportsForRoom,
    updateHudBadge,
  };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
