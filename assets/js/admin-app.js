// ===================================
// ADMIN APP - MAIN APPLICATION LOGIC
// ===================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    addDoc, 
    updateDoc, 
    deleteDoc,
    query, 
    where, 
    orderBy, 
    limit,
    Timestamp 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { logout, getCurrentAdminData } from './auth.js';

// ===================================
// GLOBAL STATE
// ===================================

let currentAdmin = null;
let currentSection = 'dashboard';
let allVideos = [];
let allTests = [];
let allMaterials = [];
let allDoubts = [];
let allUsers = [];
let currentDoubtId = null;
let currentUserId = null;
let currentTestId = null;
let currentQuestionImageFile = null;
let currentQuestionImageURL = null;
let currentSolutionImageFile = null;
let currentSolutionImageURL = null;
let currentTestForResults = null;
let currentTestIdForAccess = null;  // For test access management
let allUsersForAccessGrant = [];    // For user selection in grant modal

// Backend API base URL
const API_BASE_URL = 'https://geocatalyst-admin-backend.onrender.com';

// ===================================
// YOUTUBE HELPER FUNCTION
// ===================================

function extractYouTubeID(url) {
    /**
     * Extract YouTube video ID from various URL formats:
     * - https://www.youtube.com/watch?v=VIDEO_ID
     * - https://youtu.be/VIDEO_ID
     * - https://www.youtube.com/embed/VIDEO_ID
     */
    if (!url) return null;
    
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/
    ];
    
    for (let pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    
    return null;
}

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentAdmin = await getCurrentAdminData();
            if (currentAdmin) {
                initializeApp();
            } else {
                window.location.href = 'index.html';
            }
        } else {
            window.location.href = 'index.html';
        }
    });
});

async function initializeApp() {
    // Display admin info
    displayAdminInfo();

    // Setup navigation
    setupNavigation();

    // Setup modals
    setupModals();

    // Setup forms
    setupForms();

    // Load initial data
    await loadDashboardData();

    // Setup event listeners
    setupEventListeners();
}

// ===================================
// ADMIN INFO DISPLAY
// ===================================

function displayAdminInfo() {
    const adminName = document.getElementById('adminName');
    const adminEmail = document.getElementById('adminEmail');
    const adminInitials = document.getElementById('adminInitials');

    if (currentAdmin) {
        adminName.textContent = currentAdmin.name || 'Admin';
        adminEmail.textContent = currentAdmin.email || '';
        
        const initials = currentAdmin.name 
            ? currentAdmin.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
            : 'AD';
        adminInitials.textContent = initials;
    }
}

// ===================================
// NAVIGATION
// ===================================

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionName = item.dataset.section;
            switchSection(sectionName);
        });
    });

    // Quick action buttons
    const quickActionBtns = document.querySelectorAll('.quick-action-btn');
    quickActionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sectionName = btn.dataset.section;
            switchSection(sectionName);
        });
    });

    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Sidebar toggle (for mobile)
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
    });

    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        refreshCurrentSection();
    });
}

function switchSection(sectionName) {
    currentSection = sectionName;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === sectionName) {
            item.classList.add('active');
        }
    });

    // Update sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`${sectionName}Section`).classList.add('active');

    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        videos: 'Video Management',
        tests: 'Test Management',
        materials: 'Study Materials',
        doubts: 'Doubt Management',
        users: 'User Management',
        analytics: 'Analytics & Reports',
        settings: 'Platform Settings'
    };
    document.getElementById('pageTitle').textContent = titles[sectionName] || 'Dashboard';

    // Load section data
    loadSectionData(sectionName);
}

async function loadSectionData(sectionName) {
    switch(sectionName) {
        case 'dashboard':
            await loadDashboardData();
            break;
        case 'videos':
            await loadVideos();
            break;
        case 'tests':
            await loadTests();
            break;
        case 'materials':
            await loadMaterials();
            break;
        case 'doubts':
            await loadDoubts();
            break;
        case 'users':
            await loadUsers();
            break;
        case 'analytics':
            await loadAnalytics();
            break;
        case 'settings':
            await loadSettings();
            break;
    }
}

async function refreshCurrentSection() {
    showToast('Refreshing data...');
    await loadSectionData(currentSection);
    showToast('Data refreshed successfully!', 'success');
}

// ===================================
// MODALS
// ===================================

function setupModals() {
    // Close buttons
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.dataset.modal) {
                closeModal(e.target.dataset.modal);
            } else {
                const modal = e.target.closest('.modal');
                if (modal) modal.style.display = 'none';
            }
        });
    });

    // Click outside to close
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    // 🆕 ADD THIS: Close test access modal
    const closeAccessModalBtn = document.querySelector('[data-modal="manageTestAccessModal"]');
    if (closeAccessModalBtn) {
        closeAccessModalBtn.addEventListener('click', () => {
            closeModal('manageTestAccessModal');
        });
    }

    // 🆕 ADD THIS: Grant access button
    const grantAccessBtn = document.getElementById('grantAccessBtn');
    if (grantAccessBtn) {
        grantAccessBtn.addEventListener('click', grantAccessToSelected);
    }
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// ===================================
// EVENT LISTENERS
// ===================================

function setupEventListeners() {
    // Upload video button
    document.getElementById('uploadVideoBtn').addEventListener('click', () => {
        openModal('uploadVideoModal');
    });

    // YouTube URL validation (real-time)
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    if (youtubeUrlInput) {
        youtubeUrlInput.addEventListener('input', (e) => {
            const url = e.target.value.trim();
            const videoId = extractYouTubeID(url);
            const preview = document.getElementById('youtubePreview');
            const detectedId = document.getElementById('detectedVideoId');
            
            if (videoId) {
                preview.style.display = 'block';
                detectedId.textContent = videoId;
            } else {
                preview.style.display = 'none';
            }
        });
    }

    // Create test button
    document.getElementById('createTestBtn').addEventListener('click', () => {
        openModal('createTestModal');
    });

    // Upload material button
    document.getElementById('uploadMaterialBtn').addEventListener('click', () => {
        openModal('uploadMaterialModal');
    });

    // Analytics date range filter
    const dateRangeSelect = document.getElementById('analyticsDateRange');
    if (dateRangeSelect) {
        dateRangeSelect.addEventListener('change', () => {
            if (currentSection === 'analytics') {
                loadAnalytics();
            }
        });
    }

    // Filter listeners
    setupFilterListeners();
}

function setupFilterListeners() {
    // Video filters
    ['videoSubjectFilter', 'videoAccessFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterVideos);
    });
    document.getElementById('videoSearchInput')?.addEventListener('input', filterVideos);

    // Test filters
    ['testSubjectFilter', 'testTypeFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterTests);
    });
    document.getElementById('testSearchInput')?.addEventListener('input', filterTests);

    // Material filters
    ['materialSubjectFilter', 'materialTypeFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterMaterials);
    });
    document.getElementById('materialSearchInput')?.addEventListener('input', filterMaterials);

    // Doubt filters
    ['doubtStatusFilter', 'doubtSubjectFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterDoubts);
    });
    document.getElementById('doubtSearchInput')?.addEventListener('input', filterDoubts);

    // User filters
    ['userPlanFilter', 'userSortFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterUsers);
    });
    document.getElementById('userSearchInput')?.addEventListener('input', filterUsers);
}

// ===================================
// FORMS SETUP
// ===================================

function setupForms() {
    // Upload video form
    document.getElementById('uploadVideoForm').addEventListener('submit', handleVideoUpload);

    // Create test form
    document.getElementById('createTestForm').addEventListener('submit', handleCreateTest);

    // Upload material form
    document.getElementById('uploadMaterialForm').addEventListener('submit', handleMaterialUpload);

    // Reply to doubt form
    document.getElementById('replyDoubtForm').addEventListener('submit', handleDoubtReply);

    // Mark resolved button
    document.getElementById('markResolvedBtn').addEventListener('click', markDoubtResolved);

    // Manage access form
    document.getElementById('manageAccessForm').addEventListener('submit', handleGrantAccess);

    // Edit video form
    document.getElementById('editVideoForm').addEventListener('submit', handleEditVideo);

    // Edit test form
    document.getElementById('editTestForm').addEventListener('submit', handleEditTest);

    // Add question form
    document.getElementById('addQuestionForm').addEventListener('submit', handleAddQuestion);

    // Question type change
    document.getElementById('questionType').addEventListener('change', handleQuestionTypeChange);

    // 🆕 Question image upload
    const imageUploadInput = document.getElementById('questionImageUpload');
    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleQuestionImageUpload(file);
            }
        });
    }
    
    // 🆕 Remove image button
    const removeImageBtn = document.getElementById('removeQuestionImageBtn');
    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', clearQuestionImage);
    }

    // 🆕 Solution image upload
    const solutionImageUploadInput = document.getElementById('solutionImageUpload');
    if (solutionImageUploadInput) {
        solutionImageUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleSolutionImageUpload(file);
            }
        });
    }

    // 🆕 Remove solution image button
    const removeSolutionImageBtn = document.getElementById('removeSolutionImageBtn');
    if (removeSolutionImageBtn) {
        removeSolutionImageBtn.addEventListener('click', clearSolutionImage);
    }
}

// ===================================
// DASHBOARD DATA
// ===================================

async function loadDashboardData() {
    showLoading('Loading dashboard data...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/dashboard/analytics`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to load dashboard data');

        const data = await response.json();

        // Update stats
        document.getElementById('totalStudents').textContent = data.totalStudents || 0;
        document.getElementById('totalRevenue').textContent = `₹${data.totalRevenue || 0}`;
        document.getElementById('totalVideos').textContent = data.totalVideos || 0;
        document.getElementById('totalTests').textContent = data.totalTests || 0;
        document.getElementById('pendingDoubts').textContent = data.pendingDoubts || 0;
        document.getElementById('activeUsers').textContent = data.activeUsers || 0;

        document.getElementById('studentsChange').textContent = `+${data.newStudentsThisMonth || 0} this month`;
        document.getElementById('revenueChange').textContent = `+₹${data.revenueThisMonth || 0} this month`;

        // Load recent activity
        displayRecentActivity(data.recentActivity || []);

    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Failed to load dashboard data', 'error');
    } finally {
        hideLoading();
    }
}

function displayRecentActivity(activities) {
    const container = document.getElementById('recentActivity');
    
    if (!activities || activities.length === 0) {
        container.innerHTML = '<p class="empty-state">No recent activity</p>';
        return;
    }

    container.innerHTML = activities.map(activity => `
        <div class="activity-item">
            <span class="activity-icon">${activity.icon || '📌'}</span>
            <div class="activity-content">
                <p class="activity-text">${escapeHtml(activity.text)}</p>
                <p class="activity-time">${formatTimeAgo(activity.timestamp)}</p>
            </div>
        </div>
    `).join('');
}

function getActivityIcon(type) {
    const icons = {
        video: '🎥',
        test: '📝',
        user: '👤',
        payment: '💰',
        doubt: '💬',
        material: '📚'
    };
    return icons[type] || '📌';
}

// ===================================
// VIDEO MANAGEMENT
// ===================================

async function loadVideos() {
    showLoading('Loading videos...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/videos`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to load videos');

        allVideos = await response.json();
        displayVideos(allVideos);

    } catch (error) {
        console.error('Error loading videos:', error);
        showToast('Failed to load videos', 'error');
        document.getElementById('videosTableBody').innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load videos</td></tr>';
    } finally {
        hideLoading();
    }
}

function displayVideos(videos) {
    const tbody = document.getElementById('videosTableBody');

    if (videos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No videos found</td></tr>';
        return;
    }

    tbody.innerHTML = videos.map(video => `
        <tr>
            <td>${escapeHtml(video.title)}</td>
            <td>${escapeHtml(video.subject)}</td>
            <td>${escapeHtml(video.chapter)}</td>
            <td>${video.youtubeId ? `YT: ${video.youtubeId.substring(0, 8)}...` : formatDuration(video.duration)}</td>
            <td><span class="badge badge-${video.access}">${video.access}</span></td>
            <td>${video.views || 0}</td>
            <td>${formatDate(video.uploadedAt)}</td>
            <td>
                <button class="btn-icon" onclick="editVideo('${video.id}')" title="Edit">✏️</button>
                <button class="btn-icon" onclick="deleteVideo('${video.id}')" title="Delete">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function filterVideos() {
    const subjectFilter = document.getElementById('videoSubjectFilter').value;
    const accessFilter = document.getElementById('videoAccessFilter').value;
    const searchQuery = document.getElementById('videoSearchInput').value.toLowerCase();

    const filtered = allVideos.filter(video => {
        const matchSubject = !subjectFilter || video.subject === subjectFilter;
        const matchAccess = !accessFilter || video.access === accessFilter;
        const matchSearch = !searchQuery || 
            video.title.toLowerCase().includes(searchQuery) ||
            video.subject.toLowerCase().includes(searchQuery) ||
            video.chapter.toLowerCase().includes(searchQuery);

        return matchSubject && matchAccess && matchSearch;
    });

    displayVideos(filtered);
}

// async function handleVideoUpload(event) {
//     event.preventDefault();

//     const fileInput = document.getElementById('videoFileInput');
//     const file = fileInput.files[0];

//     if (!file) {
//         showToast('Please select a video file', 'error');
//         return;
//     }

//     // Get all metadata from the form
//     const title = document.getElementById('videoTitle').value;
//     const subject = document.getElementById('videoSubject').value;
//     const chapter = document.getElementById('videoChapter').value;
//     const order = document.getElementById('videoOrder').value;
//     const description = document.getElementById('videoDescription').value;
//     const access = document.getElementById('videoAccess').value;
//     const tags = document.getElementById('videoTags').value;

//     const submitBtn = document.getElementById('uploadVideoSubmitBtn');
//     submitBtn.disabled = true;

//     // Progress bar elements
//     const progressContainer = document.getElementById('uploadProgress');
//     const progressFill = document.getElementById('uploadProgressFill');
//     const progressText = document.getElementById('uploadProgressText');
//     progressContainer.style.display = 'block';
//     progressFill.style.width = '0%';
//     progressText.textContent = '0%';

//     try {
//         console.log('\n' + '='.repeat(60));
//         console.log('🎬 Starting Video Upload with TUS Protocol');
//         console.log('='.repeat(60));
//         console.log('📁 File:', file.name);
//         console.log('📦 Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
//         console.log('🎯 Type:', file.type);

//         // ===================================
//         // STEP 1: Upload file using TUS Protocol
//         // ===================================
//         submitBtn.innerHTML = '<span>Uploading...</span>';

//         // Calculate proper chunk size (must be divisible by 256 KiB)
//         const MIN_CHUNK_SIZE = 5 * 1024 * 1024;  // 5 MB
//         const RECOMMENDED_CHUNK_SIZE = 10 * 1024 * 1024; // Use 10 MB chunk size
//         const KiB_256 = 256 * 1024;
        
//         // Round to nearest multiple of 256 KiB
//         let chunkSize = RECOMMENDED_CHUNK_SIZE;
//         chunkSize = Math.floor(chunkSize / KiB_256) * KiB_256;
        
//         console.log('⚙️ Chunk size:', (chunkSize / 1024 / 1024).toFixed(2), 'MB');

//         // Get Firebase auth token
//         const idToken = await auth.currentUser.getIdToken();

//         let videoUid = null; // Initialize videoUid here

//         // Wrap TUS upload in a Promise
//         await new Promise((resolve, reject) => {
//             // Create TUS upload
//             const upload = new tus.Upload(file, {
//                 // ✅ CRITICAL: Endpoint points to YOUR backend, not Cloudflare
//                 endpoint: `${API_BASE_URL}/api/tus-upload-endpoint`,
                
//                 // Retry configuration
//                 retryDelays: [0, 3000, 5000, 10000, 20000],
                
//                 // Chunk size (must be 5MB minimum and divisible by 256 KiB)
//                 chunkSize: chunkSize,
                
//                 // Metadata (will be sent in Upload-Metadata header)
//                 metadata: {
//                     filename: file.name,
//                     filetype: file.type,
//                     name: title  // Video name in Cloudflare dashboard
//                 },
                
//                 // Headers - include Firebase auth token
//                 headers: {
//                     'Authorization': `Bearer ${idToken}`
//                 },
                
//                 // Upload size
//                 uploadSize: file.size,
                
//                 // Callbacks
//                 onError: (error) => {
//                     console.error('❌ TUS Upload Error:', error);
//                     reject(new Error('Upload failed: ' + error.message));
//                 },
                
//                 onProgress: (bytesUploaded, bytesTotal) => {
//                     const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(0);
//                     progressFill.style.width = `${percentage}%`;
//                     progressText.textContent = `${percentage}%`;
//                     submitBtn.innerHTML = `<span>Uploading (${percentage}%)...</span>`;
                    
//                     // Log progress every 10%
//                     if (percentage % 10 === 0 && percentage !== '0') {
//                         console.log(`📊 Upload progress: ${percentage}%`);
//                     }
//                 },
                
//                 // --- THIS IS THE UPDATED onSuccess ---
//                 onSuccess: () => {
//                     console.log('✅ TUS Upload successful!');
                    
//                     // Get the upload URL from the tus object
//                     const uploadUrl = upload.url;
//                     console.log('Upload URL:', uploadUrl);
                    
//                     if (uploadUrl) {
//                         // The URL is: .../api/tus-upload-endpoint/client/v4/accounts/.../media/VIDEO_ID
//                         // We just want the last part (the VIDEO_ID)
//                         const urlParts = uploadUrl.split('/');
//                         const uid = urlParts.pop() || urlParts.pop(); // Get last part, handling potential trailing slash
                        
//                         if (uid) {
//                             videoUid = uid; // Set the videoUid variable here
//                             console.log('📹 Video UID extracted from URL:', videoUid);
//                         }
//                     }
                    
//                     resolve(); // Resolve the promise AFTER setting videoUid
//                 },
//                 // --- NO onAfterResponse HERE ---
                
//             }); // End of tus.Upload options

//             console.log('🚀 Starting TUS upload...');
//             upload.start();
//         }); // End of new Promise

//         // Now, check if videoUid was successfully extracted
//         if (!videoUid) {
//             // This error will be thrown if onSuccess failed to extract the UID
//             throw new Error('Failed to get video UID after upload completed');
//         }

//         console.log('✅ Upload completed. Video UID:', videoUid);

//         // ===================================
//         // STEP 2: Save metadata to Firestore
//         // ===================================
//         submitBtn.innerHTML = '<span>Saving metadata...</span>';

//         const videoData = {
//             cloudflareUid: videoUid,
//             title,
//             subject,
//             chapter,
//             order: parseInt(order) || 0,
//             description,
//             access,
//             tags: tags.split(',').map(t => t.trim()).filter(t => t),
//             uploadedBy: currentAdmin.uid,
//             uploadedByName: currentAdmin.name,
//             views: 0,
//             isActive: true
//             // Firestore timestamps will be added by the backend
//         };

//         console.log('💾 Saving video metadata...');

//         const saveResponse = await fetch(`${API_BASE_URL}/api/videos`, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Bearer ${idToken}`
//             },
//             body: JSON.stringify(videoData)
//         });

//         if (!saveResponse.ok) {
//             const errorData = await saveResponse.json();
//             throw new Error(errorData.error || 'Failed to save video metadata');
//         }

//         console.log('✅ Video metadata saved!');

//         // ===================================
//         // STEP 3: Check if video is ready to stream (Optional)
//         // ===================================
//         submitBtn.innerHTML = '<span>Processing...</span>';
        
//         console.log('⏳ Checking video processing status...');
        
//         // Poll for readyToStream status (optional but recommended)
//         let isReady = false;
//         let attempts = 0;
//         const maxAttempts = 6;  // Check for 1 minute (6 attempts x 10 seconds)
        
//         while (!isReady && attempts < maxAttempts) {
//             await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            
//             try {
//                 const statusResponse = await fetch(
//                     `${API_BASE_URL}/api/videos/status/${videoUid}`,
//                     {
//                         headers: {
//                             'Authorization': `Bearer ${idToken}`
//                         }
//                     }
//                 );
                
//                 if (statusResponse.ok) {
//                     const statusData = await statusResponse.json();
//                     isReady = statusData.readyToStream;
                    
//                     console.log(`⏳ Video status: ${statusData.status?.state || 'unknown'}, ready: ${isReady}`);
                    
//                     if (isReady) {
//                         console.log('✅ Video is ready to stream!');
//                         break;
//                     }
//                 }
//             } catch (error) {
//                 console.warn('⚠️ Error checking video status:', error);
//             }
            
//             attempts++;
//         }

//         // Show final message
//         if (isReady) {
//             showToast('✅ Video uploaded and ready to stream!', 'success');
//         } else {
//             showToast('✅ Video uploaded! Processing may take a few minutes.', 'success');
//         }

//         console.log('='.repeat(60));
//         console.log('🎉 Video Upload Complete!');
//         console.log('='.repeat(60) + '\n');

//         // Reset form and close modal
//         closeModal('uploadVideoModal');
//         document.getElementById('uploadVideoForm').reset();
        
//         // Reload videos list
//         await loadVideos();

//     } catch (error) {
//         console.error('❌ Error in upload process:', error);
//         // Display a more specific error if available
//         showToast(error.message || 'Failed to upload video', 'error');
//     } finally {
//         submitBtn.disabled = false;
//         submitBtn.innerHTML = '<span>Upload Video</span>';
//         progressContainer.style.display = 'none';
//     }
// }

async function handleVideoUpload(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('uploadVideoSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Saving...</span>';

    try {
        // Get YouTube URL and extract ID
        const youtubeUrl = document.getElementById('youtubeUrl').value.trim();
        const youtubeId = extractYouTubeID(youtubeUrl);

        if (!youtubeId) {
            showToast('❌ Invalid YouTube URL. Please check and try again.', 'error');
            return;
        }

        console.log('📹 Saving YouTube video:', youtubeId);

        // Get all metadata from the form
        const videoData = {
            youtubeId: youtubeId,
            youtubeUrl: youtubeUrl,
            title: document.getElementById('videoTitle').value,
            subject: document.getElementById('videoSubject').value,
            chapter: document.getElementById('videoChapter').value,
            order: parseInt(document.getElementById('videoOrder').value) || 0,
            description: document.getElementById('videoDescription').value,
            access: document.getElementById('videoAccess').value,
            tags: document.getElementById('videoTags').value.split(',').map(t => t.trim()).filter(t => t),
            uploadedBy: currentAdmin.uid,
            uploadedByName: currentAdmin.name,
            views: 0,
            isActive: true
        };

        // Save to backend
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/videos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(videoData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save video');
        }

        const result = await response.json();
        console.log('✅ Video saved successfully:', result.id);

        showToast('✅ Video saved successfully!', 'success');

        // Reset form and close modal
        closeModal('uploadVideoModal');
        document.getElementById('uploadVideoForm').reset();
        document.getElementById('youtubePreview').style.display = 'none';

        // Reload videos list
        await loadVideos();

    } catch (error) {
        console.error('❌ Error saving video:', error);
        showToast(error.message || 'Failed to save video', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Upload Video</span>';
    }
}

window.editVideo = async function(videoId) {
    const video = allVideos.find(v => v.id === videoId);
    if (!video) return;

    document.getElementById('editVideoId').value = videoId;
    document.getElementById('editVideoTitle').value = video.title;
    document.getElementById('editVideoSubject').value = video.subject;
    document.getElementById('editVideoChapter').value = video.chapter;
    document.getElementById('editVideoOrder').value = video.order || '';
    document.getElementById('editVideoDescription').value = video.description || '';
    document.getElementById('editVideoAccess').value = video.access;
    document.getElementById('editVideoTags').value = video.tags ? video.tags.join(', ') : '';
    
    // Handle YouTube URL (if migrating from old system)
    if (video.youtubeUrl) {
        // If editing a YouTube video, show the URL (you could add this field to edit modal too)
        console.log('YouTube video:', video.youtubeUrl);
    }

    openModal('editVideoModal');
}

async function handleEditVideo(e) {
    e.preventDefault();

    const videoId = document.getElementById('editVideoId').value;
    const updateData = {
        title: document.getElementById('editVideoTitle').value,
        subject: document.getElementById('editVideoSubject').value,
        chapter: document.getElementById('editVideoChapter').value,
        order: parseInt(document.getElementById('editVideoOrder').value) || 0,
        description: document.getElementById('editVideoDescription').value,
        access: document.getElementById('editVideoAccess').value,
        tags: document.getElementById('editVideoTags').value.split(',').map(t => t.trim()).filter(t => t)
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/videos/${videoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            },
            body: JSON.stringify(updateData)
        });

        if (!response.ok) throw new Error('Failed to update video');

        showToast('Video updated successfully!', 'success');
        closeModal('editVideoModal');
        await loadVideos();

    } catch (error) {
        console.error('Error updating video:', error);
        showToast('Failed to update video', 'error');
    }
}

window.deleteVideo = async function(videoId) {
    if (!confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/videos/${videoId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to delete video');

        showToast('Video deleted successfully!', 'success');
        await loadVideos();

    } catch (error) {
        console.error('Error deleting video:', error);
        showToast('Failed to delete video', 'error');
    }
}

// ===================================
// TEST MANAGEMENT (UPDATED)
// ===================================

async function loadTests() {
    showLoading('Loading tests...');
    try {
        const response = await fetch(`${API_BASE_URL}/api/tests`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to load tests');
        }
        allTests = await response.json();
        displayTests(allTests);
    } catch (error) {
        console.error('Error loading tests:', error);
        showToast(`Failed to load tests: ${error.message}`, 'error');
        document.getElementById('testsTableBody').innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load tests</td></tr>';
    } finally {
        hideLoading();
    }
}

function displayTests(tests) {
    const tbody = document.getElementById('testsTableBody');
    if (!tests || tests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No tests found</td></tr>';
        return;
    }

    tbody.innerHTML = tests.map(test => {
        // Calculate total marks from questions array if available
        const calculatedTotalMarks = test.questions ? test.questions.reduce((sum, q) => sum + (q.marks || 0), 0) : (test.totalMarks || 0);

        return `
            <tr>
                <td>${escapeHtml(test.name)}</td>
                <td>${escapeHtml(test.subject)}</td>
                <td><span class="badge badge-${test.type}">${test.type}</span></td>
                <td>${test.questions?.length || 0}</td>
                <td>${calculatedTotalMarks}</td>
                <td>${test.duration} min</td>
                <td>${formatDate(test.createdAt)}</td>
                <td>
                    <button class="btn-icon" onclick="addQuestions('${test.id}')" title="Manage Questions">📝</button>
                    <button class="btn-icon" onclick="viewTestResults('${test.id}')" title="View Results">📊</button>
                    <button class="btn-icon" onclick="manageTestAccess('${test.id}')" title="Manage Access">🔑</button>
                    <button class="btn-icon" onclick="editTest('${test.id}')" title="Edit Test Details">✏️</button>
                    <button class="btn-icon" onclick="deleteTest('${test.id}')" title="Delete Test">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}


function filterTests() {
    const subjectFilter = document.getElementById('testSubjectFilter').value;
    const typeFilter = document.getElementById('testTypeFilter').value;
    const searchQuery = document.getElementById('testSearchInput').value.toLowerCase();

    const filtered = allTests.filter(test => {
        const matchSubject = !subjectFilter || test.subject === subjectFilter;
        const matchType = !typeFilter || test.type === typeFilter;
        const matchSearch = !searchQuery ||
            (test.name && test.name.toLowerCase().includes(searchQuery)) ||
            (test.subject && test.subject.toLowerCase().includes(searchQuery));
        return matchSubject && matchType && matchSearch;
    });
    displayTests(filtered);
}

async function handleCreateTest(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    // Use Timestamp from Firestore SDK
    const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');


    const testData = {
        name: document.getElementById('testName').value,
        subject: document.getElementById('testSubject').value,
        type: document.getElementById('testType').value,
        duration: parseInt(document.getElementById('testDuration').value),
        instructions: document.getElementById('testInstructions').value,
        access: document.getElementById('testAccess').value,
        createdBy: currentAdmin.uid,
        createdByName: currentAdmin.name,
        // createdAt handled by backend using SERVER_TIMESTAMP
        questions: [],
        totalMarks: 0, // Initialize totalMarks to 0
        // attempts: 0, // Let backend manage this if needed
        isActive: true
        // REMOVED totalMarks and passingMarks - backend will init totalMarks to 0
    };

    try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/tests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(testData)
        });

        if (!response.ok) {
             const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        currentTestId = result.id; // Assuming backend returns the new test ID

        showToast('Test created successfully! Add questions now.', 'success');
        closeModal('createTestModal');
        document.getElementById('createTestForm').reset();

        // Open add questions modal for the newly created test
        addQuestions(currentTestId); // Use the function to also load details

        await loadTests(); // Refresh the list of tests

    } catch (error) {
        console.error('Error creating test:', error);
        showToast(`Failed to create test: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

// Edit Test Details (Modal Population) - No change needed for total/passing marks removal
window.editTest = async function(testId) {
    const test = allTests.find(t => t.id === testId);
    if (!test) return;

    document.getElementById('editTestId').value = testId;
    document.getElementById('editTestName').value = test.name;
    document.getElementById('editTestSubject').value = test.subject;
    document.getElementById('editTestType').value = test.type;
    document.getElementById('editTestDuration').value = test.duration;
    // REMOVED totalMarks and passingMarks population
    document.getElementById('editTestInstructions').value = test.instructions || '';
    document.getElementById('editTestAccess').value = test.access;

    openModal('editTestModal');
}

// Handle Saving Edited Test Details - No change needed for total/passing marks removal
async function handleEditTest(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const testId = document.getElementById('editTestId').value;
    const updateData = {
        name: document.getElementById('editTestName').value,
        subject: document.getElementById('editTestSubject').value,
        type: document.getElementById('editTestType').value,
        duration: parseInt(document.getElementById('editTestDuration').value),
        instructions: document.getElementById('editTestInstructions').value,
        access: document.getElementById('editTestAccess').value
        // REMOVED totalMarks and passingMarks
    };

    try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/tests/${testId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(updateData)
        });

         if (!response.ok) {
             const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        showToast('Test details updated successfully!', 'success');
        closeModal('editTestModal');
        await loadTests(); // Refresh list

    } catch (error) {
        console.error('Error updating test:', error);
        showToast(`Failed to update test details: ${error.message}`, 'error');
    } finally {
         submitBtn.disabled = false;
    }
}

// Delete Test - No changes needed
window.deleteTest = async function(testId) {
    if (!confirm('Are you sure you want to delete this entire test and all its questions? This action cannot be undone.')) {
        return;
    }
    showLoading('Deleting test...');
    try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/tests/${testId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to delete test');
        }

        showToast('Test deleted successfully!', 'success');
        await loadTests(); // Refresh list

    } catch (error) {
        console.error('Error deleting test:', error);
        showToast(`Failed to delete test: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// ===================================
// VIEW TEST RESULTS (FEATURE 3)
// ===================================

async function viewTestResults(testId) {
    openModal('testResultsModal');
    const titleEl = document.getElementById('testResultsTitle');
    const resultsBody = document.getElementById('testResultsTableBody');

    // Reset modal state
    titleEl.textContent = 'Test Results: Loading...';
    resultsBody.innerHTML = '<tr><td colspan="10" class="empty-state">Loading results...</td></tr>';
    document.getElementById('resultsSubject').textContent = '-';
    document.getElementById('resultsTotalMarks').textContent = '-';
    document.getElementById('resultsAttemptsCount').textContent = '-';
    document.getElementById('resultsAvgScore').textContent = '-';
    document.getElementById('resultsHighScore').textContent = '-';
    currentTestForResults = null;

    try {
        const idToken = await auth.currentUser.getIdToken();

        // 1. Fetch Test Details
        const testResponse = await fetch(`${API_BASE_URL}/api/tests/${testId}`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!testResponse.ok) throw new Error('Failed to load test details');
        currentTestForResults = await testResponse.json();

        // Update modal title and summary
        titleEl.textContent = `Test Results: ${escapeHtml(currentTestForResults.name || 'Test')}`;
        document.getElementById('resultsSubject').textContent = escapeHtml(currentTestForResults.subject || '-');
        document.getElementById('resultsTotalMarks').textContent = currentTestForResults.totalMarks || 0;

        // 2. Fetch Attempts Data
        const attemptsResponse = await fetch(`${API_BASE_URL}/api/admin/tests/${testId}/attempts`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!attemptsResponse.ok) {
            const errorData = await attemptsResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to load test attempts');
        }
        const attempts = await attemptsResponse.json();

        // 3. Display Results
        displayTestResults(attempts);

    } catch (error) {
        console.error('Error fetching test results:', error);
        showToast(`Error loading results: ${error.message}`, 'error');
        titleEl.textContent = 'Test Results: Error';
        resultsBody.innerHTML = `<tr><td colspan="10" class="empty-state error-state">Could not load results: ${error.message}</td></tr>`;
    }
}

// ===================================
// RESET ATTEMPT (FEATURE 1)
// ===================================

window.resetAttempt = async function(attemptId) {
    if (!confirm('⚠️ Are you sure you want to reset this attempt? This will allow the student to retake the test. This action cannot be undone.')) {
        return;
    }

    showLoading('Resetting attempt...');

    try {
        const idToken = await auth.currentUser.getIdToken();
        
        const response = await fetch(`${API_BASE_URL}/api/admin/test-attempts/${attemptId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to reset attempt');
        }

        showToast('✅ Attempt reset successfully! Student can now retake the test.', 'success');
        
        // Reload results to reflect changes
        if (currentTestForResults && currentTestForResults.id) {
            await viewTestResults(currentTestForResults.id);
        }

    } catch (error) {
        console.error('Error resetting attempt:', error);
        showToast(`Failed to reset attempt: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// ===================================
// MANAGE TEST ACCESS (FEATURE 2)
// ===================================

window.manageTestAccess = async function(testId) {
    currentTestIdForAccess = testId;
    openModal('manageTestAccessModal');

    // Reset modal
    document.getElementById('testAccessTitle').textContent = 'Loading...';
    document.getElementById('grantedUsersList').innerHTML = '<p class="empty-state">Loading...</p>';
    document.getElementById('allUsersList').innerHTML = '<p class="empty-state">Loading...</p>';

    try {
        const idToken = await auth.currentUser.getIdToken();

        // 1. Fetch test details
        const testResponse = await fetch(`${API_BASE_URL}/api/tests/${testId}`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const test = await testResponse.json();
        document.getElementById('testAccessTitle').textContent = `Manage Access: ${escapeHtml(test.name)}`;

        // 2. Fetch users with granted access
        const accessResponse = await fetch(`${API_BASE_URL}/api/admin/tests/${testId}/access-list`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const grantedUsers = await accessResponse.json();
        displayGrantedUsers(grantedUsers);

        // 3. Fetch all users for granting
        const usersResponse = await fetch(`${API_BASE_URL}/api/users`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        allUsersForAccessGrant = await usersResponse.json();
        displayAllUsersForGrant(allUsersForAccessGrant, grantedUsers);

    } catch (error) {
        console.error('Error loading test access:', error);
        showToast(`Failed to load test access: ${error.message}`, 'error');
    }
}

function displayGrantedUsers(grantedUsers) {
    const container = document.getElementById('grantedUsersList');

    if (!grantedUsers || grantedUsers.length === 0) {
        container.innerHTML = '<p class="empty-state">No users have been granted access yet.</p>';
        return;
    }

    container.innerHTML = grantedUsers.map(grant => `
        <div class="granted-user-item">
            <div class="user-info">
                <strong>${escapeHtml(grant.userName || 'Unknown')}</strong>
                <span>${escapeHtml(grant.userEmail || '')}</span>
            </div>
            <button class="btn-icon" onclick="revokeAccess('${grant.userId}')" title="Revoke Access">❌</button>
        </div>
    `).join('');
}

function displayAllUsersForGrant(users, grantedUsers) {
    const container = document.getElementById('allUsersList');
    const grantedUserIds = new Set(grantedUsers.map(g => g.userId));

    // Filter out users who already have access
    const availableUsers = users.filter(u => !grantedUserIds.has(u.id));

    if (availableUsers.length === 0) {
        container.innerHTML = '<p class="empty-state">All users have access to this test.</p>';
        return;
    }

    container.innerHTML = availableUsers.map(user => `
        <div class="user-select-item">
            <input type="checkbox" id="user-${user.id}" value="${user.id}" class="user-checkbox">
            <label for="user-${user.id}">
                <strong>${escapeHtml(user.name || 'Unknown')}</strong>
                <span>${escapeHtml(user.email || '')}</span>
            </label>
        </div>
    `).join('');
}

window.grantAccessToSelected = async function() {
    const selectedCheckboxes = document.querySelectorAll('.user-checkbox:checked');
    const selectedUserIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (selectedUserIds.length === 0) {
        showToast('Please select at least one user', 'error');
        return;
    }

    showLoading('Granting access...');

    try {
        const idToken = await auth.currentUser.getIdToken();
        
        const response = await fetch(`${API_BASE_URL}/api/admin/tests/${currentTestIdForAccess}/grant-access`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ userIds: selectedUserIds })
        });

        if (!response.ok) throw new Error('Failed to grant access');

        const result = await response.json();
        showToast(`✅ Access granted to ${result.grantsCreated || 0} user(s)`, 'success');
        
        // Reload the modal
        await manageTestAccess(currentTestIdForAccess);

    } catch (error) {
        console.error('Error granting access:', error);
        showToast(`Failed to grant access: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

window.revokeAccess = async function(userId) {
    if (!confirm('Revoke access for this user?')) return;

    showLoading('Revoking access...');

    try {
        const idToken = await auth.currentUser.getIdToken();
        
        const response = await fetch(`${API_BASE_URL}/api/admin/tests/${currentTestIdForAccess}/revoke-access`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ userIds: [userId] })
        });

        if (!response.ok) throw new Error('Failed to revoke access');

        showToast('✅ Access revoked successfully', 'success');
        
        // Reload the modal
        await manageTestAccess(currentTestIdForAccess);

    } catch (error) {
        console.error('Error revoking access:', error);
        showToast(`Failed to revoke access: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function displayTestResults(attempts) {
    const resultsBody = document.getElementById('testResultsTableBody');
    const attemptsCountEl = document.getElementById('resultsAttemptsCount');
    const avgScoreEl = document.getElementById('resultsAvgScore');
    const highScoreEl = document.getElementById('resultsHighScore');

    if (!Array.isArray(attempts)) {
        console.error("Invalid attempts data received:", attempts);
        resultsBody.innerHTML = `<tr><td colspan="10" class="empty-state error-state">Invalid data received</td></tr>`;
        attemptsCountEl.textContent = 'Error';
        avgScoreEl.textContent = '-';
        highScoreEl.textContent = '-';
        return;
    }

    attemptsCountEl.textContent = attempts.length;

    if (attempts.length === 0) {
        resultsBody.innerHTML = '<tr><td colspan="10" class="empty-state">No attempts submitted for this test yet.</td></tr>';
        avgScoreEl.textContent = 'N/A';
        highScoreEl.textContent = 'N/A';
        return;
    }

    // Calculate summary stats
    let totalPercentageSum = 0;
    let maxPercentage = 0;
    attempts.forEach(attempt => {
        const percentage = attempt.percentage || 0;
        totalPercentageSum += percentage;
        if (percentage > maxPercentage) {
            maxPercentage = percentage;
        }
    });
    const avgPercentage = (totalPercentageSum / attempts.length).toFixed(2);

    avgScoreEl.textContent = `${avgPercentage}%`;
    highScoreEl.textContent = `${maxPercentage.toFixed(2)}%`;

    // Sort by score (descending) for ranking
    const sortedAttempts = [...attempts].sort((a, b) => (b.score || 0) - (a.score || 0));

    // Populate table with RESET button
    resultsBody.innerHTML = sortedAttempts.map((attempt, index) => {
        const score = attempt.score ?? '-';
        const percentage = attempt.percentage?.toFixed(2) ?? '-';
        const correct = attempt.correctAnswers ?? '-';
        const wrong = attempt.wrongAnswers ?? '-';
        const unattempted = attempt.unattempted ?? '-';
        const timeTaken = attempt.timeTaken ? formatTestTime(attempt.timeTaken) : '-';
        const submittedAt = attempt.submittedAt ? formatDate(new Date(attempt.submittedAt)) : '-';
        const studentName = attempt.userName || attempt.userId || 'Unknown User';
        const rank = index + 1;

        return `
            <tr>
                <td>${rank}</td>
                <td>${escapeHtml(studentName)}</td>
                <td>${score} / ${currentTestForResults?.totalMarks || '?'}</td>
                <td>${percentage}%</td>
                <td>${correct}</td>
                <td>${wrong}</td>
                <td>${unattempted}</td>
                <td>${timeTaken}</td>
                <td>${submittedAt}</td>
                <td>
                    <button class="btn-icon" onclick="resetAttempt('${attempt.id}')" title="Reset Attempt">🔄</button>
                </td>
            </tr>
        `;
    }).join('');
}

function formatTestTime(seconds) {
    if (seconds === null || typeof seconds === 'undefined') return '-';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}

// Make function globally accessible
window.viewTestResults = viewTestResults;

// Open Manage Questions Modal
window.addQuestions = async function(testId) {
    currentTestId = testId;
    document.getElementById('questionTestId').value = testId; // Set hidden input for form submission
    await loadTestQuestions(testId); // Load existing questions for this test
    openModal('addQuestionsModal');
}

// Load Existing Questions for a Test
async function loadTestQuestions(testId) {
    const container = document.getElementById('questionsList');
    const countElement = document.getElementById('questionCount');
    const totalMarksElement = document.getElementById('testTotalMarksDisplay');
    const modalTitleElement = document.getElementById('addQuestionsModalTitle');

     container.innerHTML = '<p class="empty-state">Loading questions...</p>'; // Show loading state
     countElement.textContent = '...';
     totalMarksElement.textContent = '...';
     modalTitleElement.textContent = 'Loading Test...';


    try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/tests/${testId}`, { // Fetch the specific test data
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
             const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to load test data');
        }

        const test = await response.json();
        modalTitleElement.textContent = `Manage Questions for: ${escapeHtml(test.name || 'Test')}`;
        displayTestQuestions(test.questions || [], test.totalMarks || 0);

    } catch (error) {
        console.error('Error loading test questions:', error);
        showToast(`Failed to load questions: ${error.message}`, 'error');
        container.innerHTML = '<p class="empty-state error-state">Could not load questions</p>';
        countElement.textContent = '0';
        totalMarksElement.textContent = 'Error';
         modalTitleElement.textContent = 'Error Loading Test';
    }
}

// Display Existing Questions in Modal
function displayTestQuestions(questions, totalMarks) {
    const container = document.getElementById('questionsList');
    const countElement = document.getElementById('questionCount');
    const totalMarksElement = document.getElementById('testTotalMarksDisplay');

    countElement.textContent = questions.length;
    totalMarksElement.textContent = totalMarks;

    if (questions.length === 0) {
        container.innerHTML = '<p class="empty-state">No questions added yet</p>';
        return;
    }

    container.innerHTML = questions.map((q, index) => `
        <div class="question-item">
            <div class="question-header">
                <span class="question-number">Q${index + 1}</span>
                <span class="question-type-badge">${q.type.toUpperCase()}</span>
                <span class="question-marks">${q.marks} mark(s)</span>
                ${q.negativeMarks > 0 ? `<span class="question-negative-marks">-${q.negativeMarks.toFixed(2)}</span>` : ''}
                <span class="question-difficulty">${q.difficulty}</span>
                <button class="btn-icon" onclick="deleteQuestion('${currentTestId}', ${index})" title="Delete Question">🗑️</button>
            </div>
            <div class="question-text">
                ${renderLatex(escapeHtml(q.question))}
                ${q.imageUrl ? `<div style="margin-top: 12px;"><img src="${q.imageUrl}" alt="Question Image" style="max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid #e0e0e0;"></div>` : ''}
            </div>
        </div>
    `).join('');

    if (typeof MathJax !== 'undefined') {
        MathJax.typesetPromise([container]);
    }
}

// --- Helper for LaTeX Rendering (Basic - relies on correct $ usage) ---
function renderLatex(text) {
    if (!text) return '';
    // Replace $$...$$ with display math spans
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, '<span class="latex-block">\\\[$1\\\]</span>');
    // Replace $...$ with inline math spans
    text = text.replace(/\$([^$]+?)\$/g, '<span class="latex-inline">\\($1\\)</span>');
    return text;
}


// Handle Change in Question Type Dropdown
function handleQuestionTypeChange(e) {
    const type = e.target.value;
    const markValueSelect = document.getElementById('questionMarkValue'); // Get mark value select

    // Hide all option/answer containers
    document.getElementById('mcqOptions').style.display = 'none';
    document.getElementById('msqOptions').style.display = 'none';
    document.getElementById('numericalAnswer').style.display = 'none';
    document.getElementById('trueFalseAnswer').style.display = 'none';

    // Show relevant container
    switch(type) {
        case 'mcq':
            document.getElementById('mcqOptions').style.display = 'block';
            break;
        case 'msq':
            document.getElementById('msqOptions').style.display = 'block';
            break;
        case 'numerical':
            document.getElementById('numericalAnswer').style.display = 'block';
            break;
        case 'true-false':
            document.getElementById('trueFalseAnswer').style.display = 'block';
            break;
    }

    // Reset mark value options (optional, depends if some types only allow 1 mark)
    // For GATE, all types can be 1 or 2 marks, so no change needed here usually.
    // Example if MSQ was always 2 marks:
    // if (type === 'msq') {
    //     markValueSelect.value = '2';
    //     // Optionally disable it: markValueSelect.disabled = true;
    // } else {
    //     // markValueSelect.disabled = false;
    // }
}


// Handle Adding a New Question (UPDATED with Mark Calculation)
async function handleAddQuestion(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const testId = document.getElementById('questionTestId').value;
    const type = document.getElementById('questionType').value;
    const questionText = document.getElementById('questionText').value;
    const markValue = parseInt(document.getElementById('questionMarkValue').value);
    const difficulty = document.getElementById('questionDifficulty').value;
    const explanation = document.getElementById('questionExplanation').value;

    // Calculate marks based on type
    let calculatedMarks = markValue;
    let calculatedNegativeMarks = 0;

    if (type === 'mcq') {
        if (markValue === 1) {
            calculatedNegativeMarks = 1 / 3;
        } else if (markValue === 2) {
            calculatedNegativeMarks = 2 / 3;
        }
    }

    let questionData = {
        type,
        question: questionText,
        markValue,
        marks: calculatedMarks,
        negativeMarks: parseFloat(calculatedNegativeMarks.toFixed(2)),
        difficulty,
        explanation,
        imageUrl: null, // Question image
        solutionImageUrl: null // 🆕 Solution image
    };

    // Validate answer based on type
    let isValid = true;
    try {
        switch(type) {
            case 'mcq':
                const mcqOptions = {};
                document.querySelectorAll('#mcqOptions .option-input').forEach(input => {
                    if (input.value.trim() === '') isValid = false;
                    mcqOptions[input.dataset.option] = input.value;
                });
                const correctOption = document.querySelector('#mcqOptions input[name="correctOption"]:checked')?.value;
                if (!correctOption || !isValid) {
                    showToast('MCQ requires all options filled and one correct answer selected.', 'error');
                    isValid = false; break;
                }
                questionData.options = mcqOptions;
                questionData.correctAnswer = correctOption;
                break;

            case 'msq':
                const msqOptions = {};
                document.querySelectorAll('#msqOptions .msq-option-input').forEach(input => {
                     if (input.value.trim() === '') isValid = false;
                    msqOptions[input.dataset.option] = input.value;
                });
                const correctAnswers = Array.from(document.querySelectorAll('#msqOptions .msq-correct:checked')).map(cb => cb.value);
                if (correctAnswers.length === 0 || !isValid) {
                    showToast('MSQ requires all options filled and at least one correct answer selected.', 'error');
                     isValid = false; break;
                }
                questionData.options = msqOptions;
                questionData.correctAnswers = correctAnswers;
                break;

            case 'numerical':
                const numericalAnswerInput = document.getElementById('numericalCorrectAnswer');
                const numericalAnswer = parseFloat(numericalAnswerInput.value);
                const tolerance = parseFloat(document.getElementById('numericalTolerance').value);

                if (numericalAnswerInput.value.trim() === '' || isNaN(numericalAnswer)) {
                    showToast('Please enter a valid numerical answer.', 'error');
                     isValid = false; break;
                }
                questionData.correctAnswer = numericalAnswer;
                questionData.tolerance = isNaN(tolerance) ? 0 : tolerance;
                break;

            case 'true-false':
                const tfAnswer = document.querySelector('#trueFalseAnswer input[name="trueFalseCorrect"]:checked')?.value;
                if (!tfAnswer) {
                    showToast('Please select True or False.', 'error');
                     isValid = false; break;
                }
                questionData.correctAnswer = tfAnswer === 'true';
                break;
        }

        if (!isValid) {
            submitBtn.disabled = false;
            return;
        }

    } catch (validationError) {
         console.error("Validation Error:", validationError);
         showToast('Error validating question input. Check all fields.', 'error');
         submitBtn.disabled = false;
         return;
    }

    // 🆕 UPLOAD BOTH IMAGES IF PRESENT
    showLoading('Uploading images...');
    try {
        // Upload question image
        if (currentQuestionImageFile) {
            console.log('📤 Uploading question image...');
            const imageUrl = await uploadImageToStorage(
                currentQuestionImageFile, 
                testId, 
                Date.now()
            );
            questionData.imageUrl = imageUrl;
            console.log('✅ Question image uploaded, URL:', imageUrl);
        }

        // 🆕 Upload solution image
        if (currentSolutionImageFile) {
            console.log('📤 Uploading solution image...');
            const solutionImageUrl = await uploadImageToStorage(
                currentSolutionImageFile, 
                testId, 
                Date.now() + '_solution' // Different timestamp to avoid collision
            );
            questionData.solutionImageUrl = solutionImageUrl;
            console.log('✅ Solution image uploaded, URL:', solutionImageUrl);
        }

        // Send to backend
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/tests/${testId}/questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(questionData)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
        }

        const result = await response.json();

        showToast('Question added successfully!', 'success');
        
        // 🆕 Clear both image states
        clearQuestionImage();
        clearSolutionImage();
        
        document.getElementById('addQuestionForm').reset();
        handleQuestionTypeChange({ target: document.getElementById('questionType') });

        await loadTestQuestions(testId);

    } catch (error) {
        console.error('Error adding question:', error);
        showToast(`Failed to add question: ${error.message}`, 'error');
    } finally {
        hideLoading();
        submitBtn.disabled = false;
    }
}

// Delete a Question (UPDATED)
window.deleteQuestion = async function(testId, questionIndex) {
    // Find the specific question to get its marks before deleting
    const test = allTests.find(t => t.id === testId);
    const questionToDelete = test?.questions?.[questionIndex];

    if (!questionToDelete) {
         showToast('Could not find question to delete.', 'error');
         return;
    }

    if (!confirm(`Are you sure you want to delete Question ${questionIndex + 1}?`)) {
        return;
    }

    showLoading('Deleting question...');
    try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/tests/${testId}/questions/${questionIndex}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!response.ok) {
             const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to delete question');
        }

        showToast('Question deleted successfully!', 'success');
        await loadTestQuestions(testId); // Reload to update list and total marks

    } catch (error) {
        console.error('Error deleting question:', error);
        showToast(`Failed to delete question: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}


// async function viewTestResults(testId) {
//     openModal('testResultsModal');
//     const titleEl = document.getElementById('testResultsTitle');
//     const summaryContainer = document.getElementById('testResultsSummary');
//     const resultsBody = document.getElementById('testResultsTableBody');

//     // Reset modal state
//     titleEl.textContent = 'Test Results: Loading...';
//     resultsBody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading results...</td></tr>';
//      document.getElementById('resultsSubject').textContent = '-';
//      document.getElementById('resultsTotalMarks').textContent = '-';
//      document.getElementById('resultsAttemptsCount').textContent = '-';
//      document.getElementById('resultsAvgScore').textContent = '-';
//      document.getElementById('resultsHighScore').textContent = '-';
//      currentTestForResults = null; // Clear previous test data


//     try {
//         const idToken = await auth.currentUser.getIdToken();

//         // 1. Fetch Test Details (to get name, subject, totalMarks etc.)
//         const testResponse = await fetch(`${API_BASE_URL}/api/tests/${testId}`, {
//             headers: { 'Authorization': `Bearer ${idToken}` }
//         });
//         if (!testResponse.ok) throw new Error('Failed to load test details');
//         currentTestForResults = await testResponse.json(); // Store test details globally for this modal instance

//         // Update modal title and summary basics
//         titleEl.textContent = `Test Results: ${escapeHtml(currentTestForResults.name || 'Test')}`;
//         document.getElementById('resultsSubject').textContent = escapeHtml(currentTestForResults.subject || '-');
//         document.getElementById('resultsTotalMarks').textContent = currentTestForResults.totalMarks || 0;


//         // 2. Fetch Attempts Data
//         const attemptsResponse = await fetch(`${API_BASE_URL}/api/tests/${testId}/attempts`, {
//             headers: { 'Authorization': `Bearer ${idToken}` }
//         });
//         if (!attemptsResponse.ok) {
//             const errorData = await attemptsResponse.json().catch(() => ({}));
//             throw new Error(errorData.error || 'Failed to load test attempts');
//         }
//         const attempts = await attemptsResponse.json();

//         // 3. Process and Display Results
//         displayTestResults(attempts);

//     } catch (error) {
//         console.error('Error fetching test results:', error);
//         showToast(`Error loading results: ${error.message}`, 'error');
//         titleEl.textContent = 'Test Results: Error';
//         resultsBody.innerHTML = `<tr><td colspan="9" class="empty-state error-state">Could not load results: ${error.message}</td></tr>`;
//     }
// }

// function displayTestResults(attempts) {
//     const resultsBody = document.getElementById('testResultsTableBody');
//     const attemptsCountEl = document.getElementById('resultsAttemptsCount');
//     const avgScoreEl = document.getElementById('resultsAvgScore');
//     const highScoreEl = document.getElementById('resultsHighScore');

//     if (!Array.isArray(attempts)) {
//         console.error("Invalid attempts data received:", attempts);
//         resultsBody.innerHTML = `<tr><td colspan="9" class="empty-state error-state">Invalid data received</td></tr>`;
//         attemptsCountEl.textContent = 'Error';
//         avgScoreEl.textContent = '-';
//         highScoreEl.textContent = '-';
//         return;
//     }

//      attemptsCountEl.textContent = attempts.length;


//     if (attempts.length === 0) {
//         resultsBody.innerHTML = '<tr><td colspan="9" class="empty-state">No attempts submitted for this test yet.</td></tr>';
//         avgScoreEl.textContent = 'N/A';
//         highScoreEl.textContent = 'N/A';
//         return;
//     }

//     // --- Calculate Summary Stats ---
//     let totalPercentageSum = 0;
//     let maxPercentage = 0;
//     attempts.forEach(attempt => {
//         const percentage = attempt.percentage || 0;
//         totalPercentageSum += percentage;
//         if (percentage > maxPercentage) {
//             maxPercentage = percentage;
//         }
//     });
//     const avgPercentage = (totalPercentageSum / attempts.length).toFixed(2);

//     avgScoreEl.textContent = `${avgPercentage}%`;
//     highScoreEl.textContent = `${maxPercentage.toFixed(2)}%`;

//     // --- Sort by Score (Descending) for Ranking ---
//     // Make a copy before sorting if the original order matters elsewhere
//     const sortedAttempts = [...attempts].sort((a, b) => (b.score || 0) - (a.score || 0));

//     // --- Populate Table ---
//     resultsBody.innerHTML = sortedAttempts.map((attempt, index) => {
//         // Handle potential missing data gracefully
//         const score = attempt.score ?? '-';
//         const percentage = attempt.percentage?.toFixed(2) ?? '-';
//         const correct = attempt.correctAnswers ?? '-';
//         const wrong = attempt.wrongAnswers ?? '-';
//         const unattempted = attempt.unattempted ?? '-';
//         const timeTaken = attempt.timeTaken ? formatTestTime(attempt.timeTaken) : '-'; // Helper function needed
//         const submittedAt = attempt.submittedAt ? formatDate(new Date(attempt.submittedAt)) : '-'; // Format ISO string
//         // If userName is not in attempts, you might need to fetch it (or show ID)
//         const studentName = attempt.userName || attempt.userId || 'Unknown User';
//         const rank = index + 1; // Simple rank based on score

//         return `
//             <tr>
//                 <td>${rank}</td>
//                 <td>${escapeHtml(studentName)}</td>
//                 <td>${score} / ${currentTestForResults?.totalMarks || '?'}</td>
//                 <td>${percentage}%</td>
//                 <td>${correct}</td>
//                 <td>${wrong}</td>
//                 <td>${unattempted}</td>
//                 <td>${timeTaken}</td>
//                 <td>${submittedAt}</td>
//             </tr>
//         `;
//     }).join('');
// }


// --- Add Helper Function to Format Time ---
// (Place this with other utility functions like formatDate)
// function formatTestTime(seconds) {
//     if (seconds === null || typeof seconds === 'undefined') return '-';
//     const minutes = Math.floor(seconds / 60);
//     const remainingSeconds = Math.floor(seconds % 60);
//     return `${minutes}m ${remainingSeconds}s`;
// }

/**
 * Handle question image file selection
 */
function handleQuestionImageUpload(file) {
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image size must be less than 5MB', 'error');
        return;
    }
    
    // Store file for later upload
    currentQuestionImageFile = file;
    
    // Show preview
    const preview = document.getElementById('questionImagePreview');
    const previewImg = document.getElementById('questionImagePreviewImg');
    
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
    
    console.log('✅ Question image selected:', file.name);
}

/**
 * Upload image to Firebase Storage
 */
async function uploadImageToStorage(file, testId, questionIndex) {
    try {
        const timestamp = Date.now();
        const fileExtension = file.name.split('.').pop();
        const filename = `test-questions/${testId}/q${questionIndex}_${timestamp}.${fileExtension}`;
        
        // Create FormData
        const formData = new FormData();
        formData.append('image', file);
        formData.append('path', filename);
        
        // Upload to backend
        const response = await fetch(`${API_BASE_URL}/api/admin/upload-question-image`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to upload image');
        }
        
        const result = await response.json();
        console.log('✅ Image uploaded successfully:', result.imageUrl);
        
        return result.imageUrl;
        
    } catch (error) {
        console.error('❌ Error uploading image:', error);
        throw error;
    }
}

/**
 * Clear question image
 */
function clearQuestionImage() {
    currentQuestionImageFile = null;
    currentQuestionImageURL = null;
    
    document.getElementById('questionImageUpload').value = '';
    document.getElementById('questionImagePreview').style.display = 'none';
    document.getElementById('questionImagePreviewImg').src = '';
}

// Make the view function globally accessible if needed
window.viewTestResults = viewTestResults;

/**
 * Handle solution image file selection
 */
function handleSolutionImageUpload(file) {
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image size must be less than 5MB', 'error');
        return;
    }
    
    // Store file for later upload
    currentSolutionImageFile = file;
    
    // Show preview
    const preview = document.getElementById('solutionImagePreview');
    const previewImg = document.getElementById('solutionImagePreviewImg');
    
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
    
    console.log('✅ Solution image selected:', file.name);
}

/**
 * Clear solution image
 */
function clearSolutionImage() {
    currentSolutionImageFile = null;
    currentSolutionImageURL = null;
    
    document.getElementById('solutionImageUpload').value = '';
    document.getElementById('solutionImagePreview').style.display = 'none';
    document.getElementById('solutionImagePreviewImg').src = '';
}

// ===================================
// STUDY MATERIALS MANAGEMENT
// ===================================

async function loadMaterials() {
    showLoading('Loading materials...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/materials`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to load materials');

        allMaterials = await response.json();
        displayMaterials(allMaterials);

    } catch (error) {
        console.error('Error loading materials:', error);
        showToast('Failed to load materials', 'error');
        document.getElementById('materialsTableBody').innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load materials</td></tr>';
    } finally {
        hideLoading();
    }
}

function displayMaterials(materials) {
    const tbody = document.getElementById('materialsTableBody');

    if (materials.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No materials found</td></tr>';
        return;
    }

    tbody.innerHTML = materials.map(material => `
        <tr>
            <td>${escapeHtml(material.title)}</td>
            <td>${escapeHtml(material.subject)}</td>
            <td><span class="badge badge-${material.type}">${material.type}</span></td>
            <td>${formatFileSize(material.size)}</td>
            <td>${material.downloads || 0}</td>
            <td>${formatDate(material.uploadedAt)}</td>
            <td>
                <button class="btn-icon" onclick="deleteMaterial('${material.id}')" title="Delete">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function filterMaterials() {
    const subjectFilter = document.getElementById('materialSubjectFilter').value;
    const typeFilter = document.getElementById('materialTypeFilter').value;
    const searchQuery = document.getElementById('materialSearchInput').value.toLowerCase();

    const filtered = allMaterials.filter(material => {
        const matchSubject = !subjectFilter || material.subject === subjectFilter;
        const matchType = !typeFilter || material.type === typeFilter;
        const matchSearch = !searchQuery || 
            material.title.toLowerCase().includes(searchQuery) ||
            material.subject.toLowerCase().includes(searchQuery);

        return matchSubject && matchType && matchSearch;
    });

    displayMaterials(filtered);
}

async function handleMaterialUpload(e) {
    e.preventDefault();

    const fileInput = document.getElementById('materialFileInput');
    const file = fileInput.files[0];

    if (!file) {
        showToast('Please select a PDF file', 'error');
        return;
    }

    const materialData = {
        title: document.getElementById('materialTitle').value,
        subject: document.getElementById('materialSubject').value,
        type: document.getElementById('materialType').value,
        description: document.getElementById('materialDescription').value,
        access: document.getElementById('materialAccess').value,
        size: file.size,
        uploadedBy: currentAdmin.uid,
        uploadedByName: currentAdmin.name,
        uploadedAt: Timestamp.now(),
        downloads: 0
    };

    showLoading('Uploading material...');

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('metadata', JSON.stringify(materialData));

        const response = await fetch(`${API_BASE_URL}/api/materials`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            },
            body: formData
        });

        if (!response.ok) throw new Error('Failed to upload material');

        showToast('Material uploaded successfully!', 'success');
        closeModal('uploadMaterialModal');
        document.getElementById('uploadMaterialForm').reset();
        await loadMaterials();

    } catch (error) {
        console.error('Error uploading material:', error);
        showToast('Failed to upload material', 'error');
    } finally {
        hideLoading();
    }
}

window.deleteMaterial = async function(materialId) {
    if (!confirm('Are you sure you want to delete this material?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/materials/${materialId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to delete material');

        showToast('Material deleted successfully!', 'success');
        await loadMaterials();

    } catch (error) {
        console.error('Error deleting material:', error);
        showToast('Failed to delete material', 'error');
    }
}

// ===================================
// DOUBT MANAGEMENT
// ===================================

async function loadDoubts() {
    showLoading('Loading doubts...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/doubts`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to load doubts');

        allDoubts = await response.json();
        displayDoubts(allDoubts);

    } catch (error) {
        console.error('Error loading doubts:', error);
        showToast('Failed to load doubts', 'error');
        document.getElementById('doubtsList').innerHTML = '<p class="empty-state">Failed to load doubts</p>';
    } finally {
        hideLoading();
    }
}

function displayDoubts(doubts) {
    const container = document.getElementById('doubtsList');

    // Added check to ensure doubts is an array
    if (!Array.isArray(doubts) || doubts.length === 0) {
        container.innerHTML = '<p class="empty-state">No doubts found</p>';
        return;
    }

    container.innerHTML = doubts.map(doubt => {
        // --- Get Preview Text Safely ---
        let previewText = "No question text found."; // Default text
        if (doubt.conversationLog && doubt.conversationLog.length > 0 && doubt.conversationLog[0].text) {
            const firstMessage = doubt.conversationLog[0].text;
            previewText = escapeHtml(firstMessage.substring(0, 150)) + (firstMessage.length > 150 ? '...' : '');
        } else if (doubt.question) {
             // Fallback for older doubts that might still have the question field
             previewText = escapeHtml(doubt.question.substring(0, 150)) + (doubt.question.length > 150 ? '...' : '');
        }
        // --- End Get Preview ---

        // --- Use Correct Name Field ---
        const studentName = doubt.userName || 'N/A'; // Use userName, fallback to N/A
        // --- End Name Field ---

        // Determine subject and chapter safely
        const subjectDisplay = escapeHtml(doubt.subject || 'General');
        const chapterDisplay = escapeHtml(doubt.chapter || 'General'); // Use chapter if available

        return `
            <div class="doubt-card" onclick="viewDoubt('${doubt.id}')">
                <div class="doubt-card-header">
                    <div class="doubt-card-status">
                        <span class="status-badge status-${doubt.status || 'unknown'}">${doubt.status || 'unknown'}</span>
                    </div>
                    <span class="doubt-card-date">${formatDate(doubt.createdAt)}</span>
                </div>
                <div class="doubt-card-body">
                    <h4>${subjectDisplay} - ${chapterDisplay}</h4>
                    <p class="doubt-card-text">${previewText}</p>
                    <p class="doubt-card-student">Asked by: ${escapeHtml(studentName)}</p>
                </div>
            </div>
        `;
    }).join('');
}

function filterDoubts() {
    const statusFilter = document.getElementById('doubtStatusFilter').value;
    const subjectFilter = document.getElementById('doubtSubjectFilter').value;
    const searchQuery = document.getElementById('doubtSearchInput').value.toLowerCase();

    const filtered = allDoubts.filter(doubt => {
        const matchStatus = !statusFilter || doubt.status === statusFilter;
        const matchSubject = !subjectFilter || doubt.subject === subjectFilter;
        const matchSearch = !searchQuery || 
            doubt.question.toLowerCase().includes(searchQuery) ||
            doubt.studentName.toLowerCase().includes(searchQuery);

        return matchStatus && matchSubject && matchSearch;
    });

    displayDoubts(filtered);
}

window.viewDoubt = async function(doubtId) {
    currentDoubtId = doubtId;

    try {
        const response = await fetch(`${API_BASE_URL}/api/doubts/${doubtId}`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) {
            let errorMsg = 'Failed to load doubt';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch(e) {}
            throw new Error(errorMsg);
        }

        const doubt = await response.json();

        // --- Basic Info ---
        document.getElementById('doubtStudentName').textContent = doubt.userName || 'N/A';
        document.getElementById('doubtStudentEmail').textContent = doubt.userEmail || 'N/A';
        document.getElementById('doubtSubject').textContent = doubt.subject || 'N/A';
        
        // 🔥 REMOVE THIS LINE - it's causing the error
        // document.getElementById('doubtChapter').textContent = doubt.chapter || 'General';
        
        document.getElementById('doubtDate').textContent = formatDate(doubt.createdAt);
        document.getElementById('doubtStatus').textContent = doubt.status || 'unknown';
        document.getElementById('doubtStatus').className = `status-badge status-${doubt.status || 'unknown'}`;

        // Display conversation
        displayDoubtConversation(doubt.conversationLog || []);

        // Clear reply input
        const replyInput = document.getElementById('doubtReply');
        if (replyInput) replyInput.value = '';

        openModal('viewDoubtModal');

    } catch (error) {
        console.error('Error loading doubt:', error);
        showToast(`Failed to load doubt details: ${error.message}`, 'error');
    }
}


// ----- Replace your existing displayDoubtConversation function with this -----
function displayDoubtConversation(conversationLog) { // Takes the array as input
    const container = document.getElementById('doubtConversation');
    if (!container) {
        console.error("Element with ID 'doubtConversation' not found.");
        return;
    }

     if (!Array.isArray(conversationLog) || conversationLog.length === 0) {
        container.innerHTML = '<p class="empty-state">No conversation history found.</p>';
        return;
    }

    // Sort messages by timestamp just in case they aren't ordered
    conversationLog.sort((a, b) => {
        const timeA = a.timestamp?._seconds || (a.timestamp?.toDate ? a.timestamp.toDate().getTime() / 1000 : 0);
        const timeB = b.timestamp?._seconds || (b.timestamp?.toDate ? b.timestamp.toDate().getTime() / 1000 : 0);
        return timeA - timeB;
    });

    // Generate HTML for each message in the log
    container.innerHTML = conversationLog.map(message => {
        const messageTimestamp = message.timestamp ? (message.timestamp.toDate ? message.timestamp.toDate() : new Date(message.timestamp._seconds * 1000)) : null;
        // Use a consistent date format function
        const messageTimeStr = messageTimestamp ? formatDate(messageTimestamp) : '';
        const isStudent = message.senderType === 'student';

        return `
            <div class="doubt-reply ${isStudent ? 'student-question' : 'admin-reply'}">
                <div class="reply-header">
                    <strong>${escapeHtml(message.senderName || (isStudent ? 'Student' : 'Admin'))}</strong>
                    <span class="reply-date">${messageTimeStr}</span>
                </div>
                <div class="reply-text">${escapeHtml(message.text || '')}</div>
            </div>
        `;
    }).join('');

     // Scroll to the bottom of the conversation
     container.scrollTop = container.scrollHeight;
}

async function handleDoubtReply(e) {
    e.preventDefault();

    const replyText = document.getElementById('doubtReply').value;

    if (!replyText.trim()) {
        showToast('Please enter a reply', 'error');
        return;
    }

    const replyData = {
        text: replyText,
        replierName: currentAdmin.name,
        replierId: currentAdmin.uid,
        repliedAt: Timestamp.now()
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/doubts/${currentDoubtId}/reply`, { // Correct URL
            method: 'POST', // Correct method
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            },
            body: JSON.stringify(replyData) // Send only the reply object: { text: ..., replierName: ... }
        });

        if (!response.ok) throw new Error('Failed to send reply');

        showToast('Reply sent successfully!', 'success');
        document.getElementById('doubtReply').value = '';
        
        // Reload doubt details
        await viewDoubt(currentDoubtId);

    } catch (error) {
        console.error('Error sending reply:', error);
        showToast('Failed to send reply', 'error');
    }
}

async function markDoubtResolved() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/doubts/${currentDoubtId}/resolve`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to mark as resolved');

        showToast('Doubt marked as resolved!', 'success');
        closeModal('viewDoubtModal');
        await loadDoubts();

    } catch (error) {
        console.error('Error marking doubt as resolved:', error);
        showToast('Failed to mark as resolved', 'error');
    }
}

// ===================================
// USER MANAGEMENT
// ===================================

async function loadUsers() {
    showLoading('Loading users...');

    try {
        const response = await fetch(`${API_BASE_URL}/api/users`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to load users');

        allUsers = await response.json();
        displayUsers(allUsers);

    } catch (error) {
        console.error('Error loading users:', error);
        showToast('Failed to load users', 'error');
        document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load users</td></tr>';
    } finally {
        hideLoading();
    }
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${escapeHtml(user.name || 'N/A')}</td>
            <td>${escapeHtml(user.email)}</td>
            <td><span class="badge badge-${user.plan || 'free'}">${user.plan || 'Free'}</span></td>
            <td>${formatDate(user.createdAt)}</td> 
            <td>${formatDate(user.updatedAt)}</td>
            <td>
                <button class="btn-icon" onclick="viewUser('${user.id}')" title="View Details">👁️</button>
            </td>
        </tr>
    `).join('');
}

function filterUsers() {
    const planFilter = document.getElementById('userPlanFilter').value;
    const sortFilter = document.getElementById('userSortFilter').value;
    const searchQuery = document.getElementById('userSearchInput').value.toLowerCase();

    let filtered = allUsers.filter(user => {
        const matchPlan = !planFilter || user.plan === planFilter;
        const matchSearch = !searchQuery || 
            (user.name && user.name.toLowerCase().includes(searchQuery)) ||
            user.email.toLowerCase().includes(searchQuery);

        return matchPlan && matchSearch;
    });

    // Sort
    switch(sortFilter) {
        case 'newest':
            filtered.sort((a, b) => b.registeredAt?.seconds - a.registeredAt?.seconds);
            break;
        case 'oldest':
            filtered.sort((a, b) => a.registeredAt?.seconds - b.registeredAt?.seconds);
            break;
        case 'name':
            filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            break;
    }

    displayUsers(filtered);
}

window.viewUser = async function(userId) {
    currentUserId = userId;
    openModal('viewUserModal'); // Open modal immediately

    // Reset modal state to "Loading..."
    document.getElementById('userDetailName').textContent = 'Loading...';
    document.getElementById('userDetailEmail').textContent = '...';
    document.getElementById('userDetailPhone').textContent = '...';
    document.getElementById('userDetailPlan').textContent = '...';
    document.getElementById('userDetailRegistered').textContent = '...';
    document.getElementById('userDetailLastActive').textContent = '...';
    document.getElementById('userVideosWatched').textContent = '...';
    // document.getElementById('userTestsAttempted').textContent = '...';
    document.getElementById('userDoubtsAsked').textContent = '...';
    document.getElementById('userAvgScore').textContent = '...';
    document.getElementById('userPurchasedList').innerHTML = '<p class="empty-state">Loading...</p>';
    document.getElementById('userTestAttemptsList').innerHTML = '<tr><td colspan="4" class="empty-state">Loading...</td></tr>';


    try {
        // --- 1. Fetch User Details ---
        const userResponse = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });
        if (!userResponse.ok) throw new Error('Failed to load user details');
        const user = await userResponse.json();

        // Use optional chaining (?.stats?.) just in case the stats object doesn't exist
        const stats = user.stats || {}; 

        document.getElementById('userDetailName').textContent = user.name || 'N/A';
        document.getElementById('userDetailEmail').textContent = user.email;
        document.getElementById('userDetailPhone').textContent = user.phone || 'N/A';
        document.getElementById('userDetailPlan').textContent = user.plan || 'Free';
        document.getElementById('userDetailRegistered').textContent = formatDate(user.createdAt);
        document.getElementById('userDetailLastActive').textContent = formatDate(user.updatedAt);

        // Activity stats - Read from the stats object
        document.getElementById('userVideosWatched').textContent = stats.videosWatched || 0;
        // document.getElementById('userTestsAttempted').textContent = stats.testsAttempted || 0;
        document.getElementById('userDoubtsAsked').textContent = stats.doubtsAsked || 0;
        document.getElementById('userAvgScore').textContent = `${stats.avgScore || 0}%`;

        // Purchased content (this was already here)
        displayUserPurchases(user.purchases || []);


        // --- 2. Fetch User Test Attempts (The New Part) ---
        const attemptsResponse = await fetch(`${API_BASE_URL}/api/users/${userId}/attempts`, {
            headers: {
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            }
        });
        if (!attemptsResponse.ok) throw new Error('Failed to load user test attempts');
        const attempts = await attemptsResponse.json();

        // Call the new helper function to populate the table
        displayUserTestAttempts(attempts);

    } catch (error) {
        console.error('Error loading user details:', error);
        showToast('Failed to load user details', 'error');
        // Show error in modal
        document.getElementById('userDetailName').textContent = 'Error';
        document.getElementById('userTestAttemptsList').innerHTML = '<tr><td colspan="4" class="empty-state">Error loading attempts.</td></tr>';
    }
}

function displayUserPurchases(purchases) {
    const container = document.getElementById('userPurchasedList');

    if (purchases.length === 0) {
        container.innerHTML = '<p class="empty-state">No purchases yet</p>';
        return;
    }

    container.innerHTML = purchases.map(purchase => `
        <div class="purchase-item">
            <span>${escapeHtml(purchase.item)}</span>
            <span class="purchase-date">${formatDate(purchase.purchasedAt)}</span>
        </div>
    `).join('');
}

async function handleGrantAccess(e) {
    e.preventDefault();

    const subject = document.getElementById('grantSubject').value;

    if (!subject) {
        showToast('Please select a subject', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${currentUserId}/access`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
            },
            body: JSON.stringify({ subject, grantedBy: currentAdmin.uid })
        });

        if (!response.ok) throw new Error('Failed to grant access');

        showToast('Access granted successfully!', 'success');
        document.getElementById('grantSubject').value = '';
        await viewUser(currentUserId);

    } catch (error) {
        console.error('Error granting access:', error);
        showToast('Failed to grant access', 'error');
    }
}

// ===================================
// ANALYTICS
// ===================================

async function loadAnalytics() {
    showLoading('Loading analytics...');

    try {
        const dateRange = document.getElementById('analyticsDateRange')?.value || 30;
        const idToken = await auth.currentUser.getIdToken();

        // Fetch all analytics data in parallel
        const [testPerformance, engagement, doubtMetrics, signupTrends] = await Promise.all([
            fetch(`${API_BASE_URL}/api/analytics/test-performance?days=${dateRange}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            }).then(r => r.json()),
            
            fetch(`${API_BASE_URL}/api/analytics/engagement-metrics?days=${dateRange}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            }).then(r => r.json()),
            
            fetch(`${API_BASE_URL}/api/analytics/doubt-metrics`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            }).then(r => r.json()),
            
            fetch(`${API_BASE_URL}/api/analytics/signup-trends?days=${dateRange}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            }).then(r => r.json())
        ]);

        // Display all sections
        displayTestPerformance(testPerformance);
        displayEngagementMetrics(engagement);
        displayDoubtMetrics(doubtMetrics);
        displaySignupTrends(signupTrends);

    } catch (error) {
        console.error('Error loading analytics:', error);
        showToast('Failed to load analytics', 'error');
    } finally {
        hideLoading();
    }
}

// Display Test Performance
function displayTestPerformance(data) {
    const tbody = document.getElementById('testPerformanceTableBody');
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No test data available</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(test => `
        <tr>
            <td>${escapeHtml(test.name)}</td>
            <td>${escapeHtml(test.subject)}</td>
            <td>${test.attempts}</td>
            <td>${test.avgScore} / ${test.totalMarks}</td>
            <td>${test.avgPercentage}%</td>
            <td>${test.highestScore}</td>
            <td>${test.lowestScore || 'N/A'}</td>
            <td>${test.passRate}%</td>
            <td><span class="badge badge-${test.difficultyColor}">${test.difficulty}</span></td>
        </tr>
    `).join('');

    // Create difficulty chart
    createDifficultyChart(data);
}

// Display Engagement Metrics
function displayEngagementMetrics(data) {
    document.getElementById('engagementVideos').textContent = data.contentStats?.videos || 0;
    document.getElementById('engagementTests').textContent = data.contentStats?.tests || 0;
    document.getElementById('engagementMaterials').textContent = data.contentStats?.materials || 0;
    document.getElementById('engagementActiveLearners').textContent = data.activeLearners7d || 0;

    // Display most watched videos
    const container = document.getElementById('mostWatchedList');
    const videos = data.mostWatchedVideos || [];

    if (videos.length === 0) {
        container.innerHTML = '<p class="empty-state">No video data</p>';
        return;
    }

    container.innerHTML = videos.map((video, index) => `
        <div class="popular-item">
            <span class="popular-rank">#${index + 1}</span>
            <div class="popular-info">
                <p class="popular-title">${escapeHtml(video.title)}</p>
                <p class="popular-stats">${video.views} views • ${escapeHtml(video.subject)}</p>
            </div>
        </div>
    `).join('');
}

// Display Doubt Metrics
function displayDoubtMetrics(data) {
    document.getElementById('doubtsPending').textContent = data.pending || 0;
    document.getElementById('doubtsAnswered').textContent = data.answered || 0;
    document.getElementById('doubtsResolved').textContent = data.resolved || 0;
    document.getElementById('doubtsToday').textContent = data.answeredToday || 0;
    document.getElementById('avgResponseTime').textContent = `${data.avgResponseTimeHours || 0}h`;
    document.getElementById('totalDoubts').textContent = data.total || 0;
}

// Display Signup Trends
function displaySignupTrends(data) {
    document.getElementById('totalSignupsPeriod').textContent = data.totalSignups || 0;
    
    // Create signup trend chart
    createSignupChart(data.trendData || []);
}

// Create Charts (requires Chart.js)
function createDifficultyChart(testData) {
    const ctx = document.getElementById('testDifficultyChart');
    if (!ctx) return;

    // Count by difficulty
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    testData.forEach(test => {
        counts[test.difficulty] = (counts[test.difficulty] || 0) + 1;
    });

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Easy', 'Medium', 'Hard'],
            datasets: [{
                label: 'Number of Tests',
                data: [counts.Easy, counts.Medium, counts.Hard],
                backgroundColor: ['#28a745', '#ffc107', '#dc3545']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function createSignupChart(trendData) {
    const ctx = document.getElementById('signupTrendChart');
    if (!ctx) return;

    const labels = trendData.map(item => item.date);
    const data = trendData.map(item => item.signups);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Signups',
                data: data,
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

function displayPopularContent(popular) {
    const container = document.getElementById('popularVideos');

    if (!popular || popular.length === 0) {
        container.innerHTML = '<p class="empty-state">No data available</p>';
        return;
    }

    container.innerHTML = popular.map((item, index) => `
        <div class="popular-item">
            <span class="popular-rank">#${index + 1}</span>
            <div class="popular-info">
                <p class="popular-title">${escapeHtml(item.title)}</p>
                <p class="popular-stats">${item.views} views</p>
            </div>
        </div>
    `).join('');
}

function displayRecentTransactions(transactions) {
    const container = document.getElementById('recentTransactions');

    if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p class="empty-state">No transactions yet</p>';
        return;
    }

    container.innerHTML = transactions.map(txn => `
        <div class="transaction-item">
            <div class="transaction-info">
                <p class="transaction-user">${escapeHtml(txn.userName)}</p>
                <p class="transaction-plan">${escapeHtml(txn.plan)}</p>
            </div>
            <div class="transaction-amount">
                <p class="amount">₹${txn.amount}</p>
                <p class="transaction-date">${formatDate(txn.date)}</p>
            </div>
        </div>
    `).join('');
}

// ===================================
// SETTINGS
// ===================================

async function loadSettings() {
    showLoading('Loading settings...');

    try {
        const [pricingRes, subjectsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/settings/pricing`, {
                headers: { 'Authorization': `Bearer ${await auth.currentUser.getIdToken()}` }
            }),
            fetch(`${API_BASE_URL}/api/settings/subjects`, {
                headers: { 'Authorization': `Bearer ${await auth.currentUser.getIdToken()}` }
            })
        ]);

        const pricing = await pricingRes.json();
        const subjects = await subjectsRes.json();

        displayPricing(pricing);
        displaySubjects(subjects);

    } catch (error) {
        console.error('Error loading settings:', error);
        showToast('Failed to load settings', 'error');
    } finally {
        hideLoading();
    }
}

function displayPricing(pricing) {
    const container = document.getElementById('pricingList');

    if (!pricing || Object.keys(pricing).length === 0) {
        container.innerHTML = '<p class="empty-state">No pricing data</p>';
        return;
    }

    container.innerHTML = Object.entries(pricing).map(([key, value]) => `
        <div class="pricing-item">
            <span class="pricing-name">${escapeHtml(key)}</span>
            <span class="pricing-value">₹${value}</span>
        </div>
    `).join('');
}

function displaySubjects(subjects) {
    const container = document.getElementById('subjectsList');

    if (!subjects || subjects.length === 0) {
        container.innerHTML = '<p class="empty-state">No subjects</p>';
        return;
    }

    container.innerHTML = subjects.map(subject => `
        <div class="subject-item">
            <span class="subject-name">${escapeHtml(subject.name)}</span>
            <span class="subject-chapters">${subject.chapters?.length || 0} chapters</span>
        </div>
    `).join('');
}

// ===================================
// UTILITY FUNCTIONS
// ===================================

function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const text = document.getElementById('loadingText');
    text.textContent = message;
    overlay.style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.className = `toast toast-${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function escapeHtml(text) {
    if (text === null || typeof text === 'undefined') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    // Handle both Firestore Timestamp objects and potential raw seconds/nanos
    const date = timestamp.toDate ? timestamp.toDate() : (timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp));
     if (isNaN(date)) return 'Invalid Date'; // Check for invalid date
    // Use a clear format (adjust locale and options as needed)
    return date.toLocaleString('en-IN', {
         day: '2-digit',
         month: 'short',
         year: 'numeric',
         hour: '2-digit',
         minute: '2-digit',
         hour12: true // Or false for 24-hour
     });
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'N/A';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
        }
    }
    
    return 'Just now';
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// New helper function to display the list of test attempts
function displayUserTestAttempts(attempts) {
    const tbody = document.getElementById('userTestAttemptsList');
    
    if (!attempts || attempts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No test attempts found.</td></tr>';
        return;
    }

    tbody.innerHTML = attempts.map(attempt => `
        <tr>
            <td>${escapeHtml(attempt.testTitle || 'N/A')}</td>
            <td>${attempt.score} / ${attempt.totalMarks}</td>
            <td>${attempt.percentage.toFixed(2)}%</td>
            <td>${formatDate(attempt.submittedAt)}</td>
        </tr>
    `).join('');
}