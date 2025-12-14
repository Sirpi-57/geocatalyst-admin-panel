// ===================================
// AUTHENTICATION MODULE
// ===================================

import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    sendPasswordResetEmail,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { 
    doc, 
    getDoc 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ===================================
// LOGIN FUNCTIONALITY
// ===================================

if (document.getElementById('loginForm')) {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const rememberMeCheckbox = document.getElementById('rememberMe');
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    const loginLoader = document.getElementById('loginLoader');
    const errorMessage = document.getElementById('errorMessage');
    const forgotPasswordLink = document.getElementById('forgotPassword');

    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const rememberMe = rememberMeCheckbox.checked;

        // Disable button and show loader
        loginBtn.disabled = true;
        loginBtnText.style.display = 'none';
        loginLoader.style.display = 'inline-block';
        errorMessage.style.display = 'none';

        try {
            // Set persistence based on remember me
            const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(auth, persistence);

            // Sign in with Firebase Auth
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Verify user is an admin
            const isAdmin = await verifyAdminStatus(user.uid);

            if (!isAdmin) {
                // Not an admin - sign out immediately
                await signOut(auth);
                showError('Access denied. Admin privileges required.');
                return;
            }

            // Success - redirect to dashboard
            window.location.href = 'dashboard.html';

        } catch (error) {
            console.error('Login error:', error);
            showError(getErrorMessage(error.code));
        } finally {
            // Re-enable button
            loginBtn.disabled = false;
            loginBtnText.style.display = 'inline';
            loginLoader.style.display = 'none';
        }
    });

    // Forgot password handler
    forgotPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        
        if (!email) {
            showError('Please enter your email address first.');
            emailInput.focus();
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            showSuccess('Password reset email sent! Check your inbox.');
        } catch (error) {
            console.error('Password reset error:', error);
            showError(getErrorMessage(error.code));
        }
    });

    // Show error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.className = 'error-message';
        errorMessage.style.display = 'block';
    }

    // Show success message
    function showSuccess(message) {
        errorMessage.textContent = message;
        errorMessage.className = 'success-message';
        errorMessage.style.display = 'block';
    }

    // Get user-friendly error messages
    function getErrorMessage(errorCode) {
        switch (errorCode) {
            case 'auth/invalid-email':
                return 'Invalid email address format.';
            case 'auth/user-disabled':
                return 'This account has been disabled.';
            case 'auth/user-not-found':
                return 'No account found with this email.';
            case 'auth/wrong-password':
                return 'Incorrect password.';
            case 'auth/invalid-credential':
                return 'Invalid email or password.';
            case 'auth/too-many-requests':
                return 'Too many failed attempts. Please try again later.';
            case 'auth/network-request-failed':
                return 'Network error. Check your internet connection.';
            default:
                return 'Login failed. Please try again.';
        }
    }
}

// ===================================
// VERIFY ADMIN STATUS
// ===================================

async function verifyAdminStatus(uid) {
    try {
        const adminDoc = await getDoc(doc(db, 'admins', uid));
        
        if (adminDoc.exists()) {
            const adminData = adminDoc.data();
            return adminData.isActive === true;
        }
        
        return false;
    } catch (error) {
        console.error('Error verifying admin status:', error);
        return false;
    }
}

// ===================================
// PROTECT DASHBOARD PAGE
// ===================================

if (window.location.pathname.includes('dashboard.html')) {
    let authChecked = false;

    onAuthStateChanged(auth, async (user) => {
        // Prevent multiple checks
        if (authChecked) return;
        authChecked = true;

        if (user) {
            // User is signed in - verify admin status
            const isAdmin = await verifyAdminStatus(user.uid);
            
            if (isAdmin) {
                // Admin verified - dashboard can load normally
                console.log('Admin authenticated:', user.email);
                // Don't reload - just let the page continue loading
            } else {
                // Not an admin - redirect to login
                console.log('Not an admin - redirecting to login');
                await signOut(auth);
                window.location.href = 'index.html';
            }
        } else {
            // Not signed in - redirect to login
            console.log('Not authenticated - redirecting to login');
            window.location.href = 'index.html';
        }
    });
}

// ===================================
// LOGOUT FUNCTIONALITY
// ===================================

export async function logout() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        alert('Logout failed. Please try again.');
    }
}

// ===================================
// GET CURRENT USER
// ===================================

export function getCurrentUser() {
    return auth.currentUser;
}

// ===================================
// GET CURRENT ADMIN DATA
// ===================================

export async function getCurrentAdminData() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        const adminDoc = await getDoc(doc(db, 'admins', user.uid));
        if (adminDoc.exists()) {
            return {
                uid: user.uid,
                email: user.email,
                ...adminDoc.data()
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting admin data:', error);
        return null;
    }
}

// ===================================
// CHECK AUTH STATE
// ===================================

export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}