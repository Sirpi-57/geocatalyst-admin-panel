# ===================================
# GEOCATALYST ADMIN PANEL - BACKEND API
# COMPLETE VERSION WITH ALL ENDPOINTS
# UPDATED WITH PROPER TUS PROXY FOR VIDEO UPLOADS
# ===================================
import re 
import os
import json
import requests
from datetime import datetime, timedelta
from functools import wraps
from dotenv import load_dotenv
from firebase_admin import credentials, firestore, auth, storage
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore, auth, storage
from urllib.parse import urlparse
import traceback

# Load environment variables
load_dotenv()

# ===================================
# FLASK APP INITIALIZATION
# ===================================

app = Flask(__name__)

# ===================================
# CORS CONFIGURATION - UPDATED FOR TUS
# ===================================

CORS(app, resources={
    r"/api/*": {
        "origins": [
            "https://literate-capybara-5gxqv4r6prvjf4x4r-5500.app.github.dev",
            "https://literate-capybara-5gxqv4r6prvjf4x4r-5000.app.github.dev",
            "https://geocatalyst-admin.web.app",  # Firebase production - ADMIN
            "https://geocatalyst-admin.firebaseapp.com",  # Firebase alternative - ADMIN
            "http://localhost:5500",
            "http://127.0.0.1:5500",
            os.getenv('FRONTEND_URL', '')
        ],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
        "allow_headers": [
            "Content-Type", 
            "Authorization", 
            "Tus-Resumable", 
            "Upload-Length", 
            "Upload-Metadata", 
            "Upload-Offset", 
            "Upload-Concat",
            "X-Requested-With"
        ],
        "expose_headers": [
            "Location", 
            "Upload-Offset", 
            "Upload-Length", 
            "Tus-Resumable",
            "Tus-Version",
            "Tus-Extension",
            "stream-media-id",
            "X-Video-UID"
        ],
        "supports_credentials": True
    }
})

app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'your-secret-key-change-in-production')
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_VIDEO_SIZE_MB', 2000)) * 1024 * 1024

@app.after_request
def after_request(response):
    """Add CORS headers to all responses"""
    origin = request.headers.get('Origin')
    allowed_origins = [
        "https://literate-capybara-5gxqv4r6prvjf4x4r-5500.app.github.dev",
        "https://literate-capybara-5gxqv4r6prvjf4x4r-5000.app.github.dev",
        "https://geocatalyst-admin.web.app",  # Firebase production - ADMIN
        "https://geocatalyst-admin.firebaseapp.com",  # Firebase alternative - ADMIN
        "http://localhost:5500",
        "http://127.0.0.1:5500"
    ]
    
    if origin in allowed_origins:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,Tus-Resumable,Upload-Length,Upload-Metadata,Upload-Offset,Upload-Concat,X-Requested-With'
        response.headers['Access-Control-Expose-Headers'] = 'Location,Upload-Offset,Upload-Length,Tus-Resumable,Tus-Version,Tus-Extension,stream-media-id,X-Video-UID'
    
    return response


# ============================================
# FIREBASE INITIALIZATION
# ============================================

# Check if credentials are in environment variable (Render deployment)
FIREBASE_CREDENTIALS = os.environ.get('FIREBASE_CREDENTIALS')

try:
    if FIREBASE_CREDENTIALS:
        # Production: Credentials are in environment variable
        import json
        credentials_dict = json.loads(FIREBASE_CREDENTIALS)
        cred = credentials.Certificate(credentials_dict)
        print("✅ Using Firebase credentials from environment variable")
    else:
        # Development: Credentials are in file
        FIREBASE_CREDENTIALS_PATH = os.environ.get('FIREBASE_CREDENTIALS_PATH', 'firebase-admin-key.json')
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        print(f"✅ Using Firebase credentials from file: {FIREBASE_CREDENTIALS_PATH}")
    
    # Initialize Firebase with the credentials
    firebase_admin.initialize_app(cred, {
        'storageBucket': 'geocatalyst-production.firebasestorage.app'
    })
    db = firestore.client()
    bucket = storage.bucket()
    print("✅ Firebase Admin SDK initialized successfully")
except Exception as e:
    print(f"⚠️ Firebase initialization error: {e}")
    db = None
    bucket = None

# ===================================
# CLOUDFLARE STREAM CONFIGURATION
# ===================================

CLOUDFLARE_ACCOUNT_ID = os.getenv('CLOUDFLARE_ACCOUNT_ID')
CLOUDFLARE_API_TOKEN = os.getenv('CLOUDFLARE_API_TOKEN')
CLOUDFLARE_STREAM_API_URL = 'https://api.cloudflare.com/client/v4/accounts'

BACKEND_PUBLIC_URL = os.getenv('BACKEND_PUBLIC_URL')
if not BACKEND_PUBLIC_URL:
    print("⚠️ WARNING: BACKEND_PUBLIC_URL is not set in .env. Uploads will likely fail.")

# ===================================
# AUTHENTICATION MIDDLEWARE
# ===================================

def require_auth(f):
    """Decorator to require admin authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Allow OPTIONS requests without authentication (CORS preflight)
        if request.method == 'OPTIONS':
            # This is the preflight request. We must send back the
            # same CORS headers that our @after_request hook would.
            response = Response("", 204) # Create an empty response
            
            # Get the origin from the request
            origin = request.headers.get('Origin')
            
            # Use the same allowed list as your @after_request
            allowed_origins = [
                "https://literate-capybara-5gxqv4r6prvjf4x4r-5500.app.github.dev",
                "https://literate-capybara-5gxqv4r6prvjf4x4r-5000.app.github.dev",
                "https://geocatalyst-admin.web.app",  # Firebase production - ADMIN
                "https://geocatalyst-admin.firebaseapp.com",  # Firebase alternative - ADMIN
                "http://localhost:5500",
                "http://127.0.0.1:5500",
                os.getenv('FRONTEND_URL', '')
            ]
            
            if origin in allowed_origins:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Credentials'] = 'true'
                response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH'
                
                # These headers are what the browser is ASKING PERMISSION FOR
                response.headers['Access-Control-Allow-Headers'] = (
                    'Content-Type,Authorization,Tus-Resumable,Upload-Length,'
                    'Upload-Metadata,Upload-Offset,Upload-Concat,X-Requested-With'
                )
                
                # These headers are what the browser will be ALLOWED TO READ
                response.headers['Access-Control-Expose-Headers'] = (
                    'Location,Upload-Offset,Upload-Length,Tus-Resumable,'
                    'Tus-Version,Tus-Extension,stream-media-id,X-Video-UID'
                )
            
            return response # Return the new response with headers
        
        # --- This is the original auth logic for non-OPTIONS requests ---
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'error': 'No authorization header'}), 401
        
        try:
            token = auth_header.split('Bearer ')[1] if 'Bearer ' in auth_header else auth_header
            decoded_token = auth.verify_id_token(token)
            uid = decoded_token['uid']
            
            admin_ref = db.collection('admins').document(uid)
            admin_doc = admin_ref.get()
            
            if not admin_doc.exists or not admin_doc.to_dict().get('isActive', False):
                return jsonify({'error': 'Unauthorized - Admin access required'}), 403
            
            request.uid = uid
            request.admin_data = admin_doc.to_dict()
            
            return f(*args, **kwargs)
            
        except Exception as e:
            print(f"Auth error: {str(e)}")
            return jsonify({'error': 'Invalid or expired token'}), 401
    
    return decorated_function

# ===================================
# HEALTH CHECK
# ===================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'service': 'GeoCatalyst Admin API',
        'firebase': db is not None,
        'cloudflare': bool(CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)
    }), 200

# ===================================
# VIDEO UPLOAD - TUS PROXY ENDPOINT
# ✅ THIS IS THE NEW IMPLEMENTATION
# ===================================

# @app.route('/api/tus-upload-endpoint', defaults={'cf_path': ''}, methods=['POST', 'OPTIONS', 'HEAD', 'PATCH'])
# @app.route('/api/tus-upload-endpoint/<path:cf_path>', methods=['POST', 'OPTIONS', 'HEAD', 'PATCH'])
# @require_auth
# def tus_upload_proxy(cf_path):
#     """
#     TUS Upload Proxy Endpoint
    
#     This endpoint acts as a proxy between the TUS client and Cloudflare Stream.
#     It forwards all TUS protocol requests to Cloudflare while adding authentication.
    
#     It handles BOTH:
#     1. POST (creation) requests to /api/tus-upload-endpoint
#     2. PATCH/HEAD (chunk/status) requests to /api/tus-upload-endpoint/<path:...>
    
#     It rewrites the 'Location' header from Cloudflare to keep the client
#     talking to this proxy, ensuring the auth token is always added.
#     """
    
#     try:
#         # 1. Determine the target Cloudflare URL
#         if request.method == 'POST' and not cf_path:
#             # --- This is the CREATE request ---
#             cloudflare_target_url = f"{CLOUDFLARE_STREAM_API_URL}/{CLOUDFLARE_ACCOUNT_ID}/stream"
#             print(f"\n{'='*60}")
#             print(f"🎬 TUS Upload Request (CREATE)")
#             print(f"{'='*60}")
#         elif cf_path:
#             # --- This is a CHUNK/STATUS request ---
#             # cf_path will be "client/v4/accounts/ACC_ID/media/VID_ID"
#             # We reconstruct the full absolute URL Cloudflare expects
#             cloudflare_target_url = f"https://edge-production.gateway.api.cloudflare.com/{cf_path}"
#             print(f"\n{'='*60}")
#             print(f"🎬 TUS Upload Request (CHUNK/STATUS)")
#             print(f"{'='*60}")
#         else:
#             print(f"❌ Invalid TUS request: {request.method} to {request.path}")
#             return jsonify({'error': 'Invalid TUS request path'}), 400
        
#         print(f"Method: {request.method}")
#         print(f"Cloudflare Endpoint: {cloudflare_target_url}")
        
#         # Prepare headers to forward to Cloudflare
#         headers_to_forward = {
#             'Authorization': f'Bearer {CLOUDFLARE_API_TOKEN}',
#         }
        
#         # Forward all TUS-specific headers from client
#         tus_headers = [
#             'Tus-Resumable',
#             'Upload-Length',
#             'Upload-Metadata',
#             'Upload-Offset',
#             'Upload-Concat',
#             'Content-Type',
#             'Content-Length'
#         ]
        
#         for header in tus_headers:
#             if header in request.headers:
#                 headers_to_forward[header] = request.headers[header]
#                 print(f"  {header}: {request.headers[header]}")
        
#         # Forward the request body (for PATCH requests with video data)
#         body = request.get_data()
        
#         # Make request to Cloudflare
#         print(f"📤 Forwarding to Cloudflare...")
        
#         cloudflare_response = requests.request(
#             method=request.method,
#             url=cloudflare_target_url, # Use the DYNAMIC target URL
#             headers=headers_to_forward,
#             data=body,
#             timeout=300,  # 5 minute timeout for large uploads
#             stream=True
#         )
        
#         print(f"📥 Cloudflare Response: {cloudflare_response.status_code}")
        
#         # Extract headers to return to client
#         response_headers = {}
#         headers_to_return = [
#             # 'Location', # We handle this manually below
#             'Upload-Offset',
#             'Upload-Length',
#             'Tus-Resumable',
#             'Tus-Version',
#             'Tus-Extension',
#             'Tus-Max-Size',
#             'stream-media-id'
#         ]
        
#         for header in headers_to_return:
#             if header in cloudflare_response.headers:
#                 response_headers[header] = cloudflare_response.headers[header]
#                 print(f"  {header}: {cloudflare_response.headers[header]}")
        
#         # --- CRITICAL: LOCATION HEADER REWRITE ---
#         if 'Location' in cloudflare_response.headers:
#             cf_location = cloudflare_response.headers['Location']
#             print(f"  Original Location: {cf_location}")
            
#             try:
#                 # Parse the path from the absolute CF URL
#                 # e.g., "client/v4/accounts/ACC_ID/media/VID_ID"
#                 parsed_url = urlparse(cf_location)
#                 path_part = parsed_url.path.lstrip('/')

#                 # --- NEW ROBUST LOGIC ---
#                 # Use the configured public URL from .env, not request.host
#                 if BACKEND_PUBLIC_URL:
#                     # Ensure it doesn't have a trailing slash
#                     proxy_base_url = BACKEND_PUBLIC_URL.rstrip('/')
#                 else:
#                     # Fallback to the (unreliable) host-stripping logic as a last resort
#                     print("⚠️ Falling back to request.host logic...")
#                     host_without_port = request.host.split(':')[0]
#                     proxy_base_url = f"{request.scheme}://{host_without_port}"

#                 # Build the new proxied location
#                 proxy_location = f"{proxy_base_url}/api/tus-upload-endpoint/{path_part}"
#                 # --- END NEW LOGIC ---

#                 response_headers['Location'] = proxy_location
#                 print(f"  Rewritten Location: {proxy_location}")
            
#             except Exception as e:
#                 print(f"❌ FAILED TO REWRITE LOCATION HEADER: {e}")
#                 # Fallback, but this will likely fail in the browser
#                 response_headers['Location'] = cf_location
#         # --- END LOCATION REWRITE ---

#         # Get the video UID from stream-media-id header
#         video_uid = cloudflare_response.headers.get('stream-media-id', '')
#         if video_uid:
#             print(f"✅ Video UID: {video_uid}")
#             response_headers['X-Video-UID'] = video_uid  # Custom header for easy access
        
#         # Create response
#         response = Response(
#             cloudflare_response.content,
#             status=cloudflare_response.status_code,
#             headers=response_headers
#         )
        
#         print(f"{'='*60}\n")
        
#         return response
        
#     except requests.exceptions.Timeout:
#         print("⏱️ Timeout connecting to Cloudflare")
#         return jsonify({'error': 'Upload timeout'}), 504
        
#     except Exception as e:
#         print(f"❌ TUS Upload Error: {str(e)}")
#         return jsonify({'error': str(e)}), 500

# ===================================
# VIDEO MANAGEMENT ENDPOINTS
# ===================================

@app.route('/api/videos', methods=['GET'])
@require_auth
def get_videos():
    """Get all videos from Firestore"""
    try:
        videos_ref = db.collection('videos').order_by('uploadedAt', direction=firestore.Query.DESCENDING)
        videos = []
        
        for doc in videos_ref.stream():
            video_data = doc.to_dict()
            video_data['id'] = doc.id
            videos.append(video_data)
        
        return jsonify(videos), 200
        
    except Exception as e:
        print(f"❌ Error fetching videos: {str(e)}")
        return jsonify({'error': str(e)}), 500

# @app.route('/api/videos', methods=['POST'])
# @require_auth
# def save_video_metadata():
#     """Save video metadata to Firestore after successful upload"""
#     try:
#         data = request.json
        
#         # Validate required fields
#         required_fields = ['cloudflareUid', 'title', 'subject', 'chapter']
#         for field in required_fields:
#             if field not in data:
#                 return jsonify({'error': f'Missing required field: {field}'}), 400
        
#         # Add timestamp
#         data['uploadedAt'] = firestore.SERVER_TIMESTAMP
#         data['createdAt'] = firestore.SERVER_TIMESTAMP
        
#         # Save to Firestore
#         doc_ref = db.collection('videos').add(data)
        
#         print(f"✅ Video metadata saved: {doc_ref[1].id}")
        
#         return jsonify({
#             'id': doc_ref[1].id,
#             'cloudflareUid': data['cloudflareUid'],
#             'message': 'Video metadata saved successfully'
#         }), 201
        
#     except Exception as e:
#         print(f"❌ Error saving video metadata: {str(e)}")
#         return jsonify({'error': str(e)}), 500


@app.route('/api/videos', methods=['POST'])
@require_auth
def save_video_metadata():
    """Save video metadata to Firestore (YouTube version)"""
    try:
        data = request.json
        
        # Validate required fields - UPDATED for YouTube
        required_fields = ['youtubeId', 'youtubeUrl', 'title', 'subject', 'chapter']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Extract YouTube ID from URL if needed
        youtube_id = data.get('youtubeId')
        youtube_url = data.get('youtubeUrl')
        
        if not youtube_id and youtube_url:
            # Extract ID from URL as fallback
            import re
            patterns = [
                r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
                r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})'
            ]
            for pattern in patterns:
                match = re.search(pattern, youtube_url)
                if match:
                    youtube_id = match.group(1)
                    break
        
        if not youtube_id:
            return jsonify({'error': 'Invalid YouTube URL - could not extract video ID'}), 400
        
        # Prepare video data
        video_data = {
            'youtubeId': youtube_id,
            'youtubeUrl': youtube_url,
            'title': data.get('title'),
            'subject': data.get('subject'),
            'chapter': data.get('chapter'),
            'order': data.get('order', 0),
            'description': data.get('description', ''),
            'access': data.get('access', 'premium'),
            'tags': data.get('tags', []),
            'uploadedBy': request.uid,
            'uploadedByName': data.get('uploadedByName', request.admin_data.get('name', 'Admin')),
            'views': 0,
            'isActive': True,
            'uploadedAt': firestore.SERVER_TIMESTAMP,
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        
        # Save to Firestore
        doc_ref = db.collection('videos').add(video_data)
        
        print(f"✅ YouTube video metadata saved: {doc_ref[1].id} - {youtube_id}")
        
        return jsonify({
            'id': doc_ref[1].id,
            'youtubeId': youtube_id,
            'message': 'Video metadata saved successfully'
        }), 201
        
    except Exception as e:
        print(f"❌ Error saving video metadata: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/videos/<video_id>', methods=['PUT'])
@require_auth
def update_video(video_id):
    """Update video metadata"""
    try:
        data = request.json
        
        # Remove fields that shouldn't be updated
        # data.pop('id', None)
        # data.pop('cloudflareUid', None)
        # data.pop('uploadedAt', None)
        # data.pop('createdAt', None)

        data.pop('id', None)
        data.pop('youtubeId', None)  # Changed from cloudflareUid
        data.pop('youtubeUrl', None)  # Don't allow changing YouTube URL
        data.pop('uploadedAt', None)
        data.pop('createdAt', None)
        
        # Update in Firestore
        db.collection('videos').document(video_id).update(data)
        
        print(f"✅ Video updated: {video_id}")
        
        return jsonify({'message': 'Video updated successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error updating video: {str(e)}")
        return jsonify({'error': str(e)}), 500

# @app.route('/api/videos/<video_id>', methods=['DELETE'])
# @require_auth
# def delete_video(video_id):
#     """Delete video from Firestore and Cloudflare"""
#     try:
#         # Get video data
#         video_doc = db.collection('videos').document(video_id).get()
        
#         if not video_doc.exists:
#             return jsonify({'error': 'Video not found'}), 404
        
#         video_data = video_doc.to_dict()
#         cloudflare_uid = video_data.get('cloudflareUid')
        
#         # Delete from Cloudflare if UID exists
#         if cloudflare_uid:
#             delete_url = f"{CLOUDFLARE_STREAM_API_URL}/{CLOUDFLARE_ACCOUNT_ID}/stream/{cloudflare_uid}"
#             headers = {'Authorization': f'Bearer {CLOUDFLARE_API_TOKEN}'}
            
#             cloudflare_response = requests.delete(delete_url, headers=headers, timeout=30)
            
#             if cloudflare_response.status_code == 200:
#                 print(f"✅ Video deleted from Cloudflare: {cloudflare_uid}")
#             else:
#                 print(f"⚠️ Cloudflare deletion failed: {cloudflare_response.status_code}")
        
#         # Delete from Firestore
#         db.collection('videos').document(video_id).delete()
        
#         print(f"✅ Video deleted from Firestore: {video_id}")
        
#         return jsonify({'message': 'Video deleted successfully'}), 200
        
#     except Exception as e:
#         print(f"❌ Error deleting video: {str(e)}")
#         return jsonify({'error': str(e)}), 500

@app.route('/api/videos/<video_id>', methods=['DELETE'])
@require_auth
def delete_video(video_id):
    """Delete video from Firestore (YouTube - only removes from database)"""
    try:
        # Get video data
        video_doc = db.collection('videos').document(video_id).get()
        
        if not video_doc.exists:
            return jsonify({'error': 'Video not found'}), 404
        
        # NOTE: We don't delete from YouTube - admin must do that manually if needed
        # This only removes the reference from our database
        
        # Delete from Firestore
        db.collection('videos').document(video_id).delete()
        
        print(f"✅ Video reference deleted from Firestore: {video_id}")
        print(f"ℹ️  Note: YouTube video still exists - delete manually if needed")
        
        return jsonify({
            'message': 'Video deleted successfully from database',
            'note': 'YouTube video still exists - delete manually from YouTube if needed'
        }), 200
        
    except Exception as e:
        print(f"❌ Error deleting video: {str(e)}")
        return jsonify({'error': str(e)}), 500

# @app.route('/api/videos/status/<video_uid>', methods=['GET'])
# @require_auth
# def get_video_status(video_uid):
#     """Check Cloudflare Stream video processing status"""
#     try:
#         url = f"{CLOUDFLARE_STREAM_API_URL}/{CLOUDFLARE_ACCOUNT_ID}/stream/{video_uid}"
#         headers = {
#             'Authorization': f'Bearer {CLOUDFLARE_API_TOKEN}',
#             'Content-Type': 'application/json'
#         }
        
#         response = requests.get(url, headers=headers, timeout=30)
        
#         if response.status_code != 200:
#             error_data = response.json()
#             error_msg = error_data.get('errors', [{}])[0].get('message', 'Failed to get video status')
#             return jsonify({'error': error_msg}), 500

#         result = response.json()
        
#         if not result.get('success'):
#             return jsonify({'error': 'Failed to get video status'}), 500
        
#         video_data = result['result']
        
#         status_info = {
#             'uid': video_data['uid'],
#             'readyToStream': video_data.get('readyToStream', False),
#             'status': video_data.get('status', {}),
#             'thumbnail': video_data.get('thumbnail'),
#             'preview': video_data.get('preview'),
#             'duration': video_data.get('duration'),
#             'playback': video_data.get('playback', {}),
#             'created': video_data.get('created'),
#             'modified': video_data.get('modified')
#         }
        
#         state = status_info['status'].get('state', 'unknown')
#         print(f"✅ Video {video_uid} status: {state}, readyToStream: {status_info['readyToStream']}")
        
#         return jsonify(status_info), 200

#     except requests.exceptions.Timeout:
#         return jsonify({'error': 'Request timeout'}), 504
        
#     except Exception as e:
#         print(f"❌ Error getting video status: {str(e)}")
#         return jsonify({'error': str(e)}), 500

# ===================================
# TEST MANAGEMENT ENDPOINTS
# ===================================

@app.route('/api/tests', methods=['GET'])
@require_auth # Your admin auth decorator
def get_tests():
    """Get all tests (summary including totalMarks)"""
    try:
        tests_ref = db.collection('tests').order_by('createdAt', direction=firestore.Query.DESCENDING)
        tests = []
        for doc in tests_ref.stream():
            test_data = doc.to_dict()
            test_data['id'] = doc.id
            # Ensure totalMarks is present, default to 0 if missing
            test_data.setdefault('totalMarks', 0)
            # Optionally remove the full 'questions' array for the list view to save bandwidth
            # test_data.pop('questions', None)
            tests.append(test_data)
        return jsonify(tests), 200
    except Exception as e:
        print(f"❌ Error fetching tests list: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': 'Failed to fetch tests list', 'details': str(e)}), 500


@app.route('/api/tests/<test_id>', methods=['GET'])
@require_auth # Your admin auth decorator
def get_test(test_id):
    """Get details of a specific test (including questions and totalMarks)"""
    try:
        test_doc = db.collection('tests').document(test_id).get()
        if not test_doc.exists:
            return jsonify({'error': 'Test not found'}), 404

        test_data = test_doc.to_dict()
        test_data['id'] = test_doc.id

        # Ensure totalMarks is present, default to 0 if missing
        test_data.setdefault('totalMarks', 0)
        # Ensure questions array exists
        test_data.setdefault('questions', [])

        return jsonify(test_data), 200
    except Exception as e:
        print(f"❌ Error fetching test details for {test_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': 'Failed to fetch test details', 'details': str(e)}), 500


@app.route('/api/tests', methods=['POST'])
@require_auth # Your admin auth decorator
def create_test():
    """Create a new test (initializes totalMarks to 0)"""
    try:
        data = request.json

        # Validate required fields from frontend
        required_fields = ['name', 'subject', 'type', 'duration', 'access']
        for field in required_fields:
            if field not in data or data[field] is None: # Check for None as well
                 # Handle empty string for optional fields like instructions
                 if field == 'instructions' and data.get(field) == '':
                     continue
                 return jsonify({'error': f'Missing or invalid required field: {field}'}), 400

        # Prepare data for Firestore
        test_data = {
            'name': data['name'],
            'subject': data['subject'],
            'type': data['type'],
            'duration': int(data.get('duration', 60)), # Ensure integer, provide default
            'instructions': data.get('instructions', ''),
            'access': data['access'],
            'createdBy': request.uid, # Get admin UID from decorator
            'createdByName': request.admin_data.get('name', 'Admin'), # Get admin name
            'createdAt': firestore.SERVER_TIMESTAMP,
            'questions': [], # Initialize questions as empty list
            'totalMarks': 0, # Initialize totalMarks to 0
            # 'attempts': 0, # Can be added if you track attempts directly on test doc
            'isActive': True
            # REMOVED passingMarks
        }

        # Save to Firestore
        doc_ref = db.collection('tests').add(test_data)
        new_test_id = doc_ref[1].id

        print(f"✅ Test created: {new_test_id} (Initial Total Marks: 0)")

        # Return the ID and a message
        return jsonify({
            'id': new_test_id,
            'message': 'Test created successfully. Add questions now.'
        }), 201

    except Exception as e:
        print(f"❌ Error creating test: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/api/tests/<test_id>', methods=['PUT'])
@require_auth # Your admin auth decorator
def update_test(test_id):
    """Update test metadata (name, subject, duration, etc. NOT questions or totalMarks)"""
    try:
        data = request.json

        # Data to update (excluding fields managed elsewhere)
        update_data = {}
        allowed_fields = ['name', 'subject', 'type', 'duration', 'instructions', 'access', 'isActive']
        for field in allowed_fields:
            if field in data:
                 # Basic type checking/casting
                 if field == 'duration' and data[field] is not None:
                     try:
                         update_data[field] = int(data[field])
                     except (ValueError, TypeError):
                          return jsonify({'error': f'Invalid value for duration: {data[field]}'}), 400
                 elif field == 'isActive' and data[field] is not None:
                      update_data[field] = bool(data[field])
                 else:
                     update_data[field] = data[field] # Assumes string/correct type from frontend

        if not update_data:
             return jsonify({'error': 'No valid fields provided for update'}), 400

        # Add updatedAt timestamp
        update_data['updatedAt'] = firestore.SERVER_TIMESTAMP

        # Update in Firestore
        test_ref = db.collection('tests').document(test_id)
        test_ref.update(update_data)

        print(f"✅ Test metadata updated: {test_id}")

        # Fetch and return updated data
        updated_doc = test_ref.get()
        if updated_doc.exists:
            response_data = updated_doc.to_dict()
            response_data['id'] = updated_doc.id
            return jsonify(response_data), 200
        else:
             # Should not happen if update succeeded, but good practice
             return jsonify({'message': 'Test updated, but failed to retrieve'}), 200


    except Exception as e:
        print(f"❌ Error updating test {test_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/api/tests/<test_id>', methods=['DELETE'])
@require_auth # Your admin auth decorator
def delete_test(test_id):
    """Delete an entire test document"""
    try:
        test_ref = db.collection('tests').document(test_id)
        test_doc = test_ref.get() # Check if it exists first

        if not test_doc.exists:
             return jsonify({'error': 'Test not found'}), 404

        test_ref.delete()

        print(f"✅ Test deleted: {test_id}")

        # Also consider deleting related testAttempts (optional cleanup)
        # attempts_query = db.collection('testAttempts').where('testId', '==', test_id)
        # for attempt_doc in attempts_query.stream():
        #     attempt_doc.reference.delete()
        # print(f"🧹 Cleaned up attempts for test: {test_id}")


        return jsonify({'message': f'Test {test_id} deleted successfully'}), 200

    except Exception as e:
        print(f"❌ Error deleting test {test_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/api/tests/<test_id>/questions', methods=['POST'])
@require_auth # Your admin auth decorator
def add_question(test_id):
    """Add a question to a test's questions array and update total marks."""
    try:
        question_data = request.json

        # --- Basic Validation ---
        required_fields = ['type', 'question', 'markValue', 'marks', 'negativeMarks', 'difficulty']
        for field in required_fields:
            if field not in question_data:
                return jsonify({'error': f'Missing required question field: {field}'}), 400

        q_type = question_data.get('type')
        q_marks = question_data.get('marks', 0)

        # Type-specific validation (more robust checks can be added)
        if q_type in ['mcq', 'msq'] and (not isinstance(question_data.get('options'), dict) or not question_data['options']):
             return jsonify({'error': 'Missing or invalid options for MCQ/MSQ'}), 400
        if q_type == 'mcq' and 'correctAnswer' not in question_data:
             return jsonify({'error': 'Missing correctAnswer for MCQ'}), 400
        if q_type == 'msq' and (not isinstance(question_data.get('correctAnswers'), list) or not question_data['correctAnswers']):
             return jsonify({'error': 'Missing or invalid correctAnswers array for MSQ'}), 400
        if q_type == 'numerical' and 'correctAnswer' not in question_data: # Consider checking type too
            return jsonify({'error': 'Missing or invalid correctAnswer for Numerical'}), 400
        if q_type == 'true-false' and not isinstance(question_data.get('correctAnswer'), bool): # Check for boolean
            return jsonify({'error': 'Missing or invalid boolean correctAnswer for True/False'}), 400
        # --- End Validation ---

        test_ref = db.collection('tests').document(test_id)

        # --- Use Firestore Transaction for Atomic Update ---
        @firestore.transactional
        def update_test_with_question(transaction, test_ref_in_tx, new_question):
            snapshot = test_ref_in_tx.get(transaction=transaction)
            if not snapshot.exists:
                raise FileNotFoundError("Test document not found!") # Use specific exception

            current_questions = snapshot.to_dict().get('questions', [])
            current_questions.append(new_question) # Append the new question data

            # Atomically update questions array and increment totalMarks
            transaction.update(test_ref_in_tx, {
                'questions': current_questions,
                'totalMarks': firestore.Increment(new_question['marks']) # Increment by the marks of the new question
            })

        transaction = db.transaction()
        update_test_with_question(transaction, test_ref, question_data)
        # --- End Transaction ---

        print(f"✅ Question added to test: {test_id}. Incremented total marks by {q_marks}.")

        # Fetch updated test data to return the full state
        updated_test_doc = test_ref.get()
        response_data = updated_test_doc.to_dict()
        response_data['id'] = updated_test_doc.id
        response_data.setdefault('totalMarks', 0) # Ensure field exists
        response_data.setdefault('questions', [])

        return jsonify(response_data), 200 # Return updated test data

    except FileNotFoundError as fnf_error: # Catch specific error from transaction
         print(f"❌ Error adding question (transaction failed): {str(fnf_error)}")
         return jsonify({'error': str(fnf_error)}), 404
    except Exception as e:
        print(f"❌ Error adding question to test {test_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/api/tests/<test_id>/questions/<int:question_index>', methods=['DELETE'])
@require_auth # Your admin auth decorator
def delete_question(test_id, question_index):
    """Delete a question from a test's questions array and update total marks."""
    try:
        test_ref = db.collection('tests').document(test_id)

        # --- Use Firestore Transaction for Atomic Update ---
        @firestore.transactional
        def update_test_remove_question(transaction, test_ref_in_tx, index_to_delete):
            snapshot = test_ref_in_tx.get(transaction=transaction)
            if not snapshot.exists:
                raise FileNotFoundError("Test document not found!")

            test_data = snapshot.to_dict()
            current_questions = test_data.get('questions', [])

            if not isinstance(current_questions, list) or index_to_delete < 0 or index_to_delete >= len(current_questions):
                raise IndexError("Question index out of bounds or questions format invalid!")

            # Remove the question and get its marks
            question_to_delete = current_questions.pop(index_to_delete)
            marks_to_decrement = question_to_delete.get('marks', 0)

            # Atomically update questions array and decrement totalMarks
            transaction.update(test_ref_in_tx, {
                'questions': current_questions,
                'totalMarks': firestore.Increment(-marks_to_decrement) # Decrement by the marks of the deleted question
            })
            return marks_to_decrement # Return the value decremented for logging

        transaction = db.transaction()
        decremented_marks = update_test_remove_question(transaction, test_ref, question_index)
        # --- End Transaction ---

        print(f"✅ Question at index {question_index} deleted from test: {test_id}. Decremented total marks by {decremented_marks}.")

        # Fetch updated test data to return the full state
        updated_test_doc = test_ref.get()
        response_data = updated_test_doc.to_dict()
        response_data['id'] = updated_test_doc.id
        response_data.setdefault('totalMarks', 0)
        response_data.setdefault('questions', [])


        return jsonify(response_data), 200 # Return updated test data

    except FileNotFoundError as fnf_error:
        print(f"❌ Error deleting question (transaction failed): {str(fnf_error)}")
        return jsonify({'error': str(fnf_error)}), 404
    except IndexError as idx_error:
        print(f"❌ Error deleting question (index invalid): {str(idx_error)}")
        return jsonify({'error': str(idx_error)}), 400 # Bad request due to invalid index
    except Exception as e:
        print(f"❌ Error deleting question {question_index} from test {test_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


# ============================================
# QUESTION IMAGE UPLOAD ENDPOINT
# ============================================

@app.route('/api/admin/upload-question-image', methods=['POST'])
@require_auth  # Your admin auth decorator
def upload_question_image():
    """Upload a question image to Firebase Storage and return the URL."""
    if not bucket:
        return jsonify({'error': 'Storage service unavailable'}), 503
    
    try:
        # Get image file from request
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        storage_path = request.form.get('path')  # Get the desired storage path
        
        if not storage_path:
            return jsonify({'error': 'Storage path not provided'}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'}
        file_extension = image_file.filename.rsplit('.', 1)[1].lower() if '.' in image_file.filename else ''
        
        if file_extension not in allowed_extensions:
            return jsonify({'error': f'Invalid file type. Allowed: {", ".join(allowed_extensions)}'}), 400
        
        print(f"📤 Uploading question image to: {storage_path}")
        
        # Upload to Firebase Storage
        blob = bucket.blob(storage_path)
        blob.upload_from_file(
            image_file,
            content_type=image_file.content_type
        )
        
        # Make the blob publicly readable
        blob.make_public()
        
        # Get public URL
        image_url = blob.public_url
        
        print(f"✅ Question image uploaded successfully: {image_url}")
        
        return jsonify({
            'success': True,
            'imageUrl': image_url,
            'storagePath': storage_path
        }), 200
        
    except Exception as e:
        print(f"❌ Error uploading question image: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to upload image: {str(e)}'}), 500       

# ===================================
# STUDY MATERIALS ENDPOINTS
# ===================================

@app.route('/api/materials', methods=['GET'])
@require_auth
def get_materials():
    """Get all study materials"""
    try:
        materials_ref = db.collection('materials').order_by('uploadedAt', direction=firestore.Query.DESCENDING)
        materials = []
        
        for doc in materials_ref.stream():
            material_data = doc.to_dict()
            material_data['id'] = doc.id
            materials.append(material_data)
        
        return jsonify(materials), 200
        
    except Exception as e:
        print(f"❌ Error fetching materials: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/materials', methods=['POST'])
@require_auth
def create_material():
    """Create a new study material (Handles FormData and uploads file)"""
    if not bucket:
        return jsonify({'error': 'Firebase Storage not initialized'}), 500

    try:
        # --- Handle FormData ---
        if 'metadata' not in request.form:
            return jsonify({'error': 'Missing metadata field in form data'}), 400
        if 'file' not in request.files:
            return jsonify({'error': 'Missing file field in form data'}), 400

        # Parse the metadata JSON string from the form
        try:
            metadata = json.loads(request.form['metadata'])
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid metadata JSON format'}), 400

        # Get the uploaded file object
        uploaded_file = request.files['file']

        # Validate required fields *within the parsed metadata*
        required_fields = ['title', 'subject', 'type', 'access', 'size']
        for field in required_fields:
            if field not in metadata:
                return jsonify({'error': f'Missing required field in metadata: {field}'}), 400

        # --- Upload File to Firebase Storage ---
        filename = uploaded_file.filename
        # Define the path in Storage (e.g., "materials/filename.pdf")
        # Make sure this matches the path your *other* backend expects
        storage_path = f"materials/{filename}"

        blob = bucket.blob(storage_path)

        print(f"📤 Uploading file '{filename}' to Storage path: '{storage_path}'...")

        # Upload the file from the request stream
        blob.upload_from_file(
            uploaded_file,
            content_type=uploaded_file.content_type
        )

        print(f"✅ File uploaded successfully.")
        # --- End Upload ---

        # Prepare data for Firestore, merging metadata and file info
        data_to_save = {
            'title': metadata['title'],
            'subject': metadata['subject'],
            'type': metadata['type'],
            'description': metadata.get('description', ''),
            'access': metadata['access'],
            'size': metadata['size'], # Use size from JS metadata
            'filename': filename, # Original filename
            'contentType': uploaded_file.content_type,
            'uploadedAt': firestore.SERVER_TIMESTAMP,
            'uploadedBy': request.uid,
            'uploadedByName': metadata.get('uploadedByName', request.admin_data.get('name', 'Admin')), # Use name from metadata or admin data
            'downloads': 0,
            'storageUrl': storage_path # Store the FULL PATH used in Storage
        }

        # Save metadata to Firestore
        doc_ref = db.collection('materials').add(data_to_save)

        print(f"✅ Material metadata saved to Firestore: {doc_ref[1].id}")

        return jsonify({
            'id': doc_ref[1].id,
            'message': 'Material uploaded and metadata saved successfully'
        }), 201

    except Exception as e:
        print(f"❌ Error creating material: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/materials/<material_id>', methods=['PUT'])
@require_auth
def update_material(material_id):
    """Update a study material"""
    try:
        data = request.json
        
        # Remove fields that shouldn't be updated
        data.pop('id', None)
        data.pop('uploadedAt', None)
        data.pop('uploadedBy', None)
        
        # Update in Firestore
        db.collection('materials').document(material_id).update(data)
        
        print(f"✅ Material updated: {material_id}")
        
        return jsonify({'message': 'Material updated successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error updating material: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/materials/<material_id>', methods=['DELETE'])
@require_auth
def delete_material(material_id):
    """Delete a study material"""
    try:
        db.collection('materials').document(material_id).delete()
        
        print(f"✅ Material deleted: {material_id}")
        
        return jsonify({'message': 'Material deleted successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error deleting material: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# DOUBTS MANAGEMENT ENDPOINTS
# ===================================

@app.route('/api/doubts', methods=['GET'])
@require_auth
def get_doubts():
    """Get all doubts"""
    try:
        doubts_ref = db.collection('doubts').order_by('createdAt', direction=firestore.Query.DESCENDING)
        doubts = []

        for doc in doubts_ref.stream():
            doubt_data = doc.to_dict()
            doubt_data['id'] = doc.id
            doubts.append(doubt_data)

        return jsonify(doubts), 200

    except Exception as e:
        print(f"❌ Error fetching doubts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/doubts/<doubt_id>', methods=['GET'])
@require_auth
def get_doubt_details(doubt_id):
    """Get details of a specific doubt"""
    try:
        doubt_doc = db.collection('doubts').document(doubt_id).get()

        if not doubt_doc.exists:
            return jsonify({'error': 'Doubt not found'}), 404

        doubt_data = doubt_doc.to_dict()
        doubt_data['id'] = doubt_doc.id

        return jsonify(doubt_data), 200

    except Exception as e:
        print(f"❌ Error fetching doubt details: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/doubts/<doubt_id>/reply', methods=['POST'])
@require_auth # Your existing admin auth decorator
def reply_to_doubt(doubt_id):
    """Append admin reply to the doubt's conversation log."""
    try:
        data = request.json
        reply_text = data.get('text')

        if not reply_text or not isinstance(reply_text, str) or not reply_text.strip():
             return jsonify({'error': 'Missing or empty reply text in the request body'}), 400

        admin_name = request.admin_data.get('name', 'Admin')

        # --- Create Reply Log Entry ---
        # --- Use datetime.now() instead of SERVER_TIMESTAMP ---
        reply_message = {
            'senderId': request.uid,
            'senderName': admin_name,
            'senderType': 'admin',
            'text': reply_text.strip(),
            'timestamp': datetime.now() # <<< CORRECTED
        }
        # --- End Correction ---

        # --- Update Firestore Document ---
        # --- Use datetime.now() for updatedAt as well ---
        update_data = {
            'conversationLog': firestore.ArrayUnion([reply_message]),
            'status': 'answered', # Or 'resolved'
            'updatedAt': datetime.now() # <<< CORRECTED
        }
        # --- End Correction ---

        db.collection('doubts').document(doubt_id).update(update_data)

        print(f"✅ Reply appended to doubt conversation: {doubt_id} by {admin_name}")

        return jsonify({'message': 'Reply sent successfully'}), 200

    except Exception as e:
        print(f"❌ Error replying to doubt: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/doubts/<doubt_id>', methods=['DELETE'])
@require_auth
def delete_doubt(doubt_id):
    """Delete a doubt"""
    try:
        db.collection('doubts').document(doubt_id).delete()

        print(f"✅ Doubt deleted: {doubt_id}")

        return jsonify({'message': 'Doubt deleted successfully'}), 200

    except Exception as e:
        print(f"❌ Error deleting doubt: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# USER MANAGEMENT ENDPOINTS
# ===================================

@app.route('/api/users', methods=['GET'])
@require_auth
def get_users():
    """Get all users"""
    try:
        users_ref = db.collection('users').order_by('createdAt', direction=firestore.Query.DESCENDING)
        users = []
        
        for doc in users_ref.stream():
            user_data = doc.to_dict()
            user_data['id'] = doc.id
            
            # === START FIX (Corrected Names) ===
            # Convert timestamps to ISO strings so JavaScript can read them
            for field in ['createdAt', 'updatedAt']: # <-- FIXED
                if user_data.get(field) and hasattr(user_data[field], 'isoformat'):
                    user_data[field] = user_data[field].isoformat()
            # === END FIX ===

            users.append(user_data)
        
        return jsonify(users), 200
        
    except Exception as e:
        print(f"❌ Error fetching users: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<user_id>', methods=['GET'])
@require_auth
def get_user_details(user_id):
    """Get details of a specific user"""
    try:
        user_doc = db.collection('users').document(user_id).get()
        
        if not user_doc.exists:
            return jsonify({'error': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        user_data['id'] = user_doc.id
        
        # === START FIX (Corrected Names) ===
        # Convert timestamps to ISO strings so JavaScript can read them
        for field in ['createdAt', 'updatedAt']: # <-- FIXED
            if user_data.get(field) and hasattr(user_data[field], 'isoformat'):
                user_data[field] = user_data[field].isoformat()
        # === END FIX ===

        return jsonify(user_data), 200
        
    except Exception as e:
        print(f"❌ Error fetching user details: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<user_id>', methods=['PUT'])
@require_auth
def update_user(user_id):
    """Update user details"""
    try:
        data = request.json
        
        # Remove fields that shouldn't be updated
        data.pop('id', None)
        data.pop('uid', None)
        data.pop('createdAt', None)
        
        # Update in Firestore
        db.collection('users').document(user_id).update(data)
        
        print(f"✅ User updated: {user_id}")
        
        return jsonify({'message': 'User updated successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error updating user: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<user_id>', methods=['DELETE'])
@require_auth
def delete_user(user_id):
    """Delete a user"""
    try:
        # Get user data
        user_doc = db.collection('users').document(user_id).get()
        
        if not user_doc.exists:
            return jsonify({'error': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        firebase_uid = user_data.get('uid')
        
        # Delete from Firebase Auth if UID exists
        if firebase_uid:
            try:
                auth.delete_user(firebase_uid)
                print(f"✅ User deleted from Firebase Auth: {firebase_uid}")
            except Exception as e:
                print(f"⚠️ Firebase Auth deletion failed: {str(e)}")
        
        # Delete from Firestore
        db.collection('users').document(user_id).delete()
        
        print(f"✅ User deleted from Firestore: {user_id}")
        
        return jsonify({'message': 'User deleted successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error deleting user: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# DASHBOARD ANALYTICS
# ===================================

@app.route('/api/dashboard/analytics', methods=['GET'])
@require_auth
def get_dashboard_analytics():
    """Get comprehensive dashboard analytics with real data"""
    try:
        from datetime import datetime, timedelta
        
        # ===================================
        # 1. COUNT TOTAL STUDENTS
        # ===================================
        students_ref = db.collection('users')
        students_count = len(list(students_ref.stream()))
        
        # ===================================
        # 2. COUNT VIDEOS
        # ===================================
        videos_count = len(list(db.collection('videos').stream()))
        
        # ===================================
        # 3. COUNT TESTS
        # ===================================
        tests_count = len(list(db.collection('tests').stream()))
        
        # ===================================
        # 4. COUNT PENDING DOUBTS
        # ===================================
        doubts_ref = db.collection('doubts').where('status', '==', 'pending')
        pending_doubts = len(list(doubts_ref.stream()))
        
        # ===================================
        # 5. CALCULATE ACTIVE USERS (last 7 days)
        # ===================================
        seven_days_ago = datetime.now() - timedelta(days=7)
        active_users_ref = db.collection('users').where('updatedAt', '>=', seven_days_ago)
        active_users = len(list(active_users_ref.stream()))
        
        # ===================================
        # 6. NEW STUDENTS THIS MONTH
        # ===================================
        start_of_month = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        new_students_ref = db.collection('users').where('createdAt', '>=', start_of_month)
        new_students_this_month = len(list(new_students_ref.stream()))
        
        # ===================================
        # 7. REVENUE (Placeholder for now)
        # ===================================
        total_revenue = 0
        revenue_this_month = 0
        
        # ===================================
        # 8. RECENT ACTIVITY FEED
        # ===================================
        recent_activity = []
        
        # Get recent test attempts (last 5)
        recent_attempts = db.collection('testAttempts')\
            .order_by('submittedAt', direction=firestore.Query.DESCENDING)\
            .limit(5)\
            .stream()
        
        for attempt_doc in recent_attempts:
            attempt_data = attempt_doc.to_dict()
            user_id = attempt_data.get('userId')
            test_id = attempt_data.get('testId')
            
            # Get user name
            try:
                user_doc = db.collection('users').document(user_id).get()
                user_name = user_doc.to_dict().get('name', 'Unknown') if user_doc.exists else 'Unknown'
            except:
                user_name = 'Unknown'
            
            # Get test name
            try:
                test_doc = db.collection('tests').document(test_id).get()
                test_name = test_doc.to_dict().get('name', 'Test') if test_doc.exists else 'Test'
            except:
                test_name = 'Test'
            
            recent_activity.append({
                'type': 'test',
                'text': f'{user_name} completed "{test_name}" test with {attempt_data.get("percentage", 0):.1f}%',
                'timestamp': attempt_data.get('submittedAt'),
                'icon': '📝'
            })
        
        # Get recent doubts (last 3)
        recent_doubts = db.collection('doubts')\
            .order_by('createdAt', direction=firestore.Query.DESCENDING)\
            .limit(3)\
            .stream()
        
        for doubt_doc in recent_doubts:
            doubt_data = doubt_doc.to_dict()
            user_name = doubt_data.get('userName', 'Unknown')
            subject = doubt_data.get('subject', 'General')
            
            recent_activity.append({
                'type': 'doubt',
                'text': f'{user_name} asked a doubt in {subject}',
                'timestamp': doubt_data.get('createdAt'),
                'icon': '💬'
            })
        
        # Get recent user signups (last 3)
        recent_users = db.collection('users')\
            .order_by('createdAt', direction=firestore.Query.DESCENDING)\
            .limit(3)\
            .stream()
        
        for user_doc in recent_users:
            user_data = user_doc.to_dict()
            user_name = user_data.get('name', 'New User')
            
            recent_activity.append({
                'type': 'user',
                'text': f'{user_name} joined GeoCatalyst',
                'timestamp': user_data.get('createdAt'),
                'icon': '👤'
            })
        
        # Sort all activities by timestamp (most recent first)
        recent_activity.sort(key=lambda x: x.get('timestamp') or datetime.min, reverse=True)
        
        # Take only top 10
        recent_activity = recent_activity[:10]
        
        # Convert timestamps to ISO format for JSON
        for activity in recent_activity:
            if activity.get('timestamp') and hasattr(activity['timestamp'], 'isoformat'):
                activity['timestamp'] = activity['timestamp'].isoformat()
        
        return jsonify({
            'totalStudents': students_count,
            'totalRevenue': total_revenue,
            'totalVideos': videos_count,
            'totalTests': tests_count,
            'pendingDoubts': pending_doubts,
            'activeUsers': active_users,
            'newStudentsThisMonth': new_students_this_month,
            'revenueThisMonth': revenue_this_month,
            'recentActivity': recent_activity
        }), 200
        
    except Exception as e:
        print(f"❌ Error fetching dashboard analytics: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ===================================
# ADVANCED ANALYTICS ENDPOINTS
# ===================================

@app.route('/api/analytics/test-performance', methods=['GET'])
@require_auth
def get_test_performance_analytics():
    """Get detailed test performance analytics"""
    try:
        from datetime import datetime, timedelta
        
        # Get date range from query params (optional)
        days = request.args.get('days', default=30, type=int)
        cutoff_date = datetime.now() - timedelta(days=days)
        
        # Get all tests
        tests = {}
        for test_doc in db.collection('tests').stream():
            test_data = test_doc.to_dict()
            tests[test_doc.id] = {
                'id': test_doc.id,
                'name': test_data.get('name', 'Unnamed Test'),
                'subject': test_data.get('subject', 'General'),
                'totalMarks': test_data.get('totalMarks', 0),
                'attempts': 0,
                'totalScore': 0,
                'avgScore': 0,
                'avgPercentage': 0,
                'highestScore': 0,
                'lowestScore': None,
                'passCount': 0,
                'passRate': 0
            }
        
        # Get all test attempts within date range
        attempts_query = db.collection('testAttempts')
        if days < 365:  # Only filter if not "all time"
            attempts_query = attempts_query.where('submittedAt', '>=', cutoff_date)
        
        for attempt_doc in attempts_query.stream():
            attempt_data = attempt_doc.to_dict()
            test_id = attempt_data.get('testId')
            
            if test_id not in tests:
                continue
            
            score = attempt_data.get('score', 0)
            percentage = attempt_data.get('percentage', 0)
            total_marks = tests[test_id]['totalMarks']
            
            tests[test_id]['attempts'] += 1
            tests[test_id]['totalScore'] += score
            
            # Track highest/lowest
            if score > tests[test_id]['highestScore']:
                tests[test_id]['highestScore'] = score
            
            if tests[test_id]['lowestScore'] is None or score < tests[test_id]['lowestScore']:
                tests[test_id]['lowestScore'] = score
            
            # Count passes (>= 40%)
            if percentage >= 40:
                tests[test_id]['passCount'] += 1
        
        # Calculate averages
        test_performance = []
        for test_id, test_info in tests.items():
            if test_info['attempts'] > 0:
                test_info['avgScore'] = round(test_info['totalScore'] / test_info['attempts'], 2)
                test_info['avgPercentage'] = round((test_info['avgScore'] / test_info['totalMarks'] * 100) if test_info['totalMarks'] > 0 else 0, 2)
                test_info['passRate'] = round((test_info['passCount'] / test_info['attempts'] * 100), 2)
                
                # Determine difficulty
                if test_info['avgPercentage'] >= 75:
                    test_info['difficulty'] = 'Easy'
                    test_info['difficultyColor'] = 'success'
                elif test_info['avgPercentage'] >= 50:
                    test_info['difficulty'] = 'Medium'
                    test_info['difficultyColor'] = 'warning'
                else:
                    test_info['difficulty'] = 'Hard'
                    test_info['difficultyColor'] = 'danger'
                
                test_performance.append(test_info)
        
        # Sort by attempts (most attempted first)
        test_performance.sort(key=lambda x: x['attempts'], reverse=True)
        
        return jsonify(test_performance), 200
        
    except Exception as e:
        print(f"❌ Error fetching test performance: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/analytics/engagement-metrics', methods=['GET'])
@require_auth
def get_engagement_metrics():
    """Get user engagement metrics"""
    try:
        from datetime import datetime, timedelta
        
        days = request.args.get('days', default=30, type=int)
        cutoff_date = datetime.now() - timedelta(days=days)
        
        # ===================================
        # 1. MOST WATCHED VIDEOS
        # ===================================
        videos_ref = db.collection('videos')\
            .order_by('views', direction=firestore.Query.DESCENDING)\
            .limit(5)
        
        most_watched = []
        total_views = 0
        
        for video_doc in videos_ref.stream():
            video_data = video_doc.to_dict()
            views = video_data.get('views', 0)
            total_views += views
            
            most_watched.append({
                'title': video_data.get('title', 'Untitled'),
                'subject': video_data.get('subject', 'General'),
                'views': views
            })
        
        # ===================================
        # 2. ACTIVE LEARNERS
        # ===================================
        active_users_7d = len(list(
            db.collection('users').where('updatedAt', '>=', datetime.now() - timedelta(days=7)).stream()
        ))
        
        # ===================================
        # 3. CONTENT STATS
        # ===================================
        total_videos = len(list(db.collection('videos').stream()))
        total_tests = len(list(db.collection('tests').stream()))
        total_materials = len(list(db.collection('materials').stream()))
        
        # ===================================
        # 4. TEST ATTEMPTS (within date range)
        # ===================================
        recent_attempts = len(list(
            db.collection('testAttempts').where('submittedAt', '>=', cutoff_date).stream()
        ))
        
        return jsonify({
            'mostWatchedVideos': most_watched,
            'totalVideoViews': total_views,
            'activeLearners7d': active_users_7d,
            'contentStats': {
                'videos': total_videos,
                'tests': total_tests,
                'materials': total_materials
            },
            'recentTestAttempts': recent_attempts
        }), 200
        
    except Exception as e:
        print(f"❌ Error fetching engagement metrics: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/analytics/doubt-metrics', methods=['GET'])
@require_auth
def get_doubt_metrics():
    """Get doubt resolution metrics"""
    try:
        from datetime import datetime, timedelta
        
        # Count by status
        pending = len(list(db.collection('doubts').where('status', '==', 'pending').stream()))
        answered = len(list(db.collection('doubts').where('status', '==', 'answered').stream()))
        resolved = len(list(db.collection('doubts').where('status', '==', 'resolved').stream()))
        
        # Doubts answered today
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        answered_today = len(list(
            db.collection('doubts')
            .where('status', 'in', ['answered', 'resolved'])
            .where('updatedAt', '>=', today_start)
            .stream()
        ))
        
        # Calculate average response time (for resolved doubts)
        resolved_doubts = db.collection('doubts').where('status', '==', 'resolved').limit(50).stream()
        
        response_times = []
        for doubt_doc in resolved_doubts:
            doubt_data = doubt_doc.to_dict()
            created = doubt_data.get('createdAt')
            updated = doubt_data.get('updatedAt')
            
            if created and updated:
                if hasattr(created, 'timestamp'):
                    created = datetime.fromtimestamp(created.timestamp())
                if hasattr(updated, 'timestamp'):
                    updated = datetime.fromtimestamp(updated.timestamp())
                
                response_time = (updated - created).total_seconds() / 3600  # hours
                response_times.append(response_time)
        
        avg_response_time = round(sum(response_times) / len(response_times), 1) if response_times else 0
        
        return jsonify({
            'pending': pending,
            'answered': answered,
            'resolved': resolved,
            'total': pending + answered + resolved,
            'answeredToday': answered_today,
            'avgResponseTimeHours': avg_response_time
        }), 200
        
    except Exception as e:
        print(f"❌ Error fetching doubt metrics: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/analytics/signup-trends', methods=['GET'])
@require_auth
def get_signup_trends():
    """Get user signup trends over time"""
    try:
        from datetime import datetime, timedelta
        from collections import defaultdict
        
        days = request.args.get('days', default=30, type=int)
        cutoff_date = datetime.now() - timedelta(days=days)
        
        # Get all users created within date range
        users_ref = db.collection('users').where('createdAt', '>=', cutoff_date).stream()
        
        # Group by date
        signups_by_date = defaultdict(int)
        
        for user_doc in users_ref:
            user_data = user_doc.to_dict()
            created_at = user_data.get('createdAt')
            
            if created_at:
                if hasattr(created_at, 'date'):
                    date_key = created_at.date().isoformat()
                else:
                    date_key = datetime.fromtimestamp(created_at.timestamp()).date().isoformat()
                
                signups_by_date[date_key] += 1
        
        # Convert to list of {date, count}
        trend_data = [
            {'date': date, 'signups': count}
            for date, count in sorted(signups_by_date.items())
        ]
        
        # Fill in missing dates with 0
        if trend_data:
            start_date = datetime.fromisoformat(trend_data[0]['date'])
            end_date = datetime.now()
            
            all_dates = {}
            current = start_date
            while current <= end_date:
                all_dates[current.date().isoformat()] = 0
                current += timedelta(days=1)
            
            # Update with actual data
            for item in trend_data:
                all_dates[item['date']] = item['signups']
            
            trend_data = [
                {'date': date, 'signups': count}
                for date, count in sorted(all_dates.items())
            ]
        
        return jsonify({
            'trendData': trend_data,
            'totalSignups': sum(item['signups'] for item in trend_data),
            'period': days
        }), 200
        
    except Exception as e:
        print(f"❌ Error fetching signup trends: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/revenue', methods=['GET'])
@require_auth
def get_revenue_analytics():
    """Get revenue analytics"""
    try:
        # TODO: Implement revenue calculation from payments collection
        return jsonify({
            'today': 0,
            'week': 0,
            'month': 0,
            'total': 0
        }), 200
        
    except Exception as e:
        print(f"❌ Error fetching revenue analytics: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/engagement', methods=['GET'])
@require_auth
def get_engagement_analytics():
    """Get user engagement analytics"""
    try:
        # TODO: Implement engagement calculation
        return jsonify({
            'totalViews': 0,
            'totalWatchTime': 0,
            'totalAttempts': 0,
            'avgScore': 0
        }), 200
        
    except Exception as e:
        print(f"❌ Error fetching engagement analytics: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/popular-content', methods=['GET'])
@require_auth
def get_popular_content():
    """Get popular content"""
    try:
        # Get top 5 videos by views
        videos_ref = db.collection('videos').order_by('views', direction=firestore.Query.DESCENDING).limit(5)
        popular = []
        
        for doc in videos_ref.stream():
            video_data = doc.to_dict()
            popular.append({
                'title': video_data.get('title'),
                'views': video_data.get('views', 0)
            })
        
        return jsonify(popular), 200
        
    except Exception as e:
        print(f"❌ Error fetching popular content: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/transactions', methods=['GET'])
@require_auth
def get_recent_transactions():
    """Get recent transactions"""
    try:
        # TODO: Implement from payments collection
        return jsonify([]), 200
        
    except Exception as e:
        print(f"❌ Error fetching transactions: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# SETTINGS ENDPOINTS
# ===================================

@app.route('/api/settings/pricing', methods=['GET'])
@require_auth
def get_pricing():
    """Get pricing settings"""
    try:
        doc = db.collection('settings').document('pricing').get()
        
        if not doc.exists:
            # Return default pricing
            return jsonify({
                'Remote Sensing': 1000,
                'GIS': 1000,
                'Image Processing': 1250,
                'GPS': 750,
                'Surveying': 1250,
                'Engineering Mathematics': 750,
                'General Aptitude': 500,
                'Test Series': 1250,
                'Master Package': 5499
            }), 200
        
        return jsonify(doc.to_dict()), 200
        
    except Exception as e:
        print(f"❌ Error fetching pricing: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/pricing', methods=['PUT'])
@require_auth
def update_pricing():
    """Update pricing settings"""
    try:
        data = request.json
        
        db.collection('settings').document('pricing').set(data, merge=True)
        
        print(f"✅ Pricing updated")
        
        return jsonify({'message': 'Pricing updated successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error updating pricing: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/subjects', methods=['GET'])
@require_auth
def get_subjects():
    """Get subjects and chapters"""
    try:
        doc = db.collection('settings').document('subjects').get()
        
        if not doc.exists:
            # Return default subjects
            return jsonify([
                {'name': 'Remote Sensing', 'chapters': []},
                {'name': 'GIS', 'chapters': []},
                {'name': 'Image Processing', 'chapters': []},
                {'name': 'GPS', 'chapters': []},
                {'name': 'Surveying', 'chapters': []},
                {'name': 'Engineering Mathematics', 'chapters': []},
                {'name': 'General Aptitude', 'chapters': []}
            ]), 200
        
        return jsonify(doc.to_dict().get('subjects', [])), 200
        
    except Exception as e:
        print(f"❌ Error fetching subjects: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# ERROR HANDLERS
# ===================================

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large error with proper CORS headers"""
    max_size_mb = app.config['MAX_CONTENT_LENGTH'] // (1024 * 1024)
    
    response = jsonify({
        'error': 'File too large',
        'message': f'Maximum file size is {max_size_mb}MB. Please compress your video.',
        'maxSizeMB': max_size_mb
    })
    
    # Explicitly add CORS headers
    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    
    return response, 413

# ===================================
# STUDENT AUTHENTICATION DECORATOR
# ===================================

def require_student_auth(f):
    """Decorator to require student authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Allow OPTIONS requests without authentication
        if request.method == 'OPTIONS':
            return '', 204
        
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'error': 'No authorization header'}), 401
        
        try:
            token = auth_header.split('Bearer ')[1] if 'Bearer ' in auth_header else auth_header
            decoded_token = auth.verify_id_token(token)
            uid = decoded_token['uid']
            
            # Get user document from Firestore
            user_ref = db.collection('users').document(uid)
            user_doc = user_ref.get()
            
            if not user_doc.exists:
                return jsonify({'error': 'User not found'}), 404
            
            # Attach user info to request
            request.uid = uid
            request.user_data = user_doc.to_dict()
            
            return f(*args, **kwargs)
            
        except Exception as e:
            print(f"Student auth error: {str(e)}")
            return jsonify({'error': 'Invalid or expired token'}), 401
    
    return decorated_function

# ===================================
# HELPER: Check if user has access to content
# ===================================

def check_user_access(user_data, content_subject, content_access='premium'):
    """Check if user has access to specific content"""
    
    # If content is free, everyone has access
    if content_access == 'free':
        return True
    
    # Check user's subscriptions
    subscriptions = user_data.get('subscriptions', [])
    
    for sub in subscriptions:
        # Check if subscription is active
        if not sub.get('isActive', False):
            continue
        
        # Check if subscription matches content subject
        if sub.get('subject') == content_subject:
            return True
        
        # Check if user has Master Package (access to all)
        if sub.get('subject') == 'Master Package':
            return True
        
        # Check if content is a test and user has Test Series
        if sub.get('subject') == 'Test Series':
            return True
    
    return False

# ===================================
# VIDEOS ENDPOINTS
# ===================================

@app.route('/api/student/videos', methods=['GET'])
@require_student_auth
def get_student_videos():
    """Get all videos accessible to the student"""
    try:
        subject = request.args.get('subject')
        chapter = request.args.get('chapter')
        
        # Build query
        videos_ref = db.collection('videos').order_by('uploadedAt', direction=firestore.Query.DESCENDING)
        
        if subject:
            videos_ref = videos_ref.where('subject', '==', subject)
        if chapter:
            videos_ref = videos_ref.where('chapter', '==', chapter)
        
        videos = []
        user_data = request.user_data
        
        for doc in videos_ref.stream():
            video_data = doc.to_dict()
            video_data['id'] = doc.id
            
            # Check access
            has_access = check_user_access(
                user_data, 
                video_data.get('subject'), 
                video_data.get('access', 'premium')
            )
            
            # Add access flag to video data
            video_data['hasAccess'] = has_access
            
            # Don't send cloudflareUid if no access (security)
            # if not has_access:
            #     video_data.pop('cloudflareUid', None)
            if not has_access:
                video_data.pop('youtubeId', None)
                video_data.pop('youtubeUrl', None)
            
            videos.append(video_data)
        
        return jsonify(videos), 200
        
    except Exception as e:
        print(f"❌ Error fetching student videos: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/student/videos/<video_id>', methods=['GET'])
@require_student_auth
def get_student_video(video_id):
    """Get single video with full details"""
    try:
        video_ref = db.collection('videos').document(video_id)
        video_doc = video_ref.get()
        
        if not video_doc.exists:
            return jsonify({'error': 'Video not found'}), 404
        
        video_data = video_doc.to_dict()
        video_data['id'] = video_doc.id
        
        # Check access
        has_access = check_user_access(
            request.user_data,
            video_data.get('subject'),
            video_data.get('access', 'premium')
        )
        
        if not has_access:
            return jsonify({
                'error': 'Access denied',
                'message': f'Subscribe to {video_data.get("subject")} to access this video'
            }), 403
        
        return jsonify(video_data), 200
        
    except Exception as e:
        print(f"❌ Error fetching video: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/student/videos/<video_id>/view', methods=['POST'])
@require_student_auth
def update_video_views(video_id):
    """Track video views and update user progress"""
    try:
        # Update video view count
        video_ref = db.collection('videos').document(video_id)
        video_ref.update({
            'views': firestore.Increment(1)
        })
        
        # Update user progress
        user_ref = db.collection('users').document(request.uid)
        user_ref.update({
            'progress.videosWatched': firestore.Increment(1),
            'progress.totalWatchTime': firestore.Increment(request.json.get('watchTime', 0))
        })
        
        return jsonify({'message': 'View recorded'}), 200
        
    except Exception as e:
        print(f"❌ Error updating views: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# TESTS ENDPOINTS
# ===================================

@app.route('/api/admin/tests/<test_id>/attempts', methods=['GET'])
@require_auth
def get_test_attempts_for_admin(test_id):
    """Fetch all student attempts for a specific test (admin)"""
    try:
        attempts_query = db.collection('testAttempts') \
            .where('testId', '==', test_id) \
            .order_by('submittedAt', direction=firestore.Query.DESCENDING)

        attempts = []
        for doc in attempts_query.stream():
            attempt_data = doc.to_dict()
            attempt_data['id'] = doc.id

            # 🔥 FETCH USER NAME
            user_id = attempt_data.get('userId')
            if user_id:
                try:
                    user_doc = db.collection('users').document(user_id).get()
                    if user_doc.exists:
                        user_data = user_doc.to_dict()
                        attempt_data['userName'] = user_data.get('name', 'Unknown User')
                        attempt_data['userEmail'] = user_data.get('email', '')
                    else:
                        attempt_data['userName'] = f'User {user_id[:8]}...'
                except Exception as e:
                    print(f"⚠️ Error fetching user {user_id}: {e}")
                    attempt_data['userName'] = f'User {user_id[:8]}...'
            else:
                attempt_data['userName'] = 'Unknown User'

            # Convert timestamp
            if 'submittedAt' in attempt_data and hasattr(attempt_data['submittedAt'], 'isoformat'):
                attempt_data['submittedAt'] = attempt_data['submittedAt'].isoformat()

            attempts.append(attempt_data)

        print(f"✅ Fetched {len(attempts)} attempts for test: {test_id}")

        return jsonify(attempts), 200

    except Exception as e:
        print(f"❌ Error fetching attempts for test {test_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/api/admin/test-attempts/<attempt_id>', methods=['DELETE'])
@require_auth
def reset_test_attempt(attempt_id):
    """Delete a test attempt (allows student to retake)"""
    try:
        # Get attempt data before deleting
        attempt_ref = db.collection('testAttempts').document(attempt_id)
        attempt_doc = attempt_ref.get()
        
        if not attempt_doc.exists:
            return jsonify({'error': 'Attempt not found'}), 404
        
        attempt_data = attempt_doc.to_dict()
        user_id = attempt_data.get('userId')
        test_id = attempt_data.get('testId')
        
        # Delete the attempt
        attempt_ref.delete()
        
        # Update user stats (decrement)
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        
        if user_doc.exists:
            user_data = user_doc.to_dict()
            stats = user_data.get('stats', {})
            
            # Decrement counters
            tests_attempted = max(0, stats.get('testsAttempted', 0) - 1)
            total_percentage_sum = max(0, stats.get('totalPercentageSum', 0) - attempt_data.get('percentage', 0))
            
            # Recalculate average
            avg_score = (total_percentage_sum / tests_attempted) if tests_attempted > 0 else 0
            
            user_ref.update({
                'stats.testsAttempted': tests_attempted,
                'stats.totalPercentageSum': total_percentage_sum,
                'stats.avgScore': avg_score
            })
        
        print(f"✅ Attempt {attempt_id} reset successfully for user {user_id}")
        
        return jsonify({'message': 'Attempt reset successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error resetting attempt {attempt_id}: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

# ===================================
# ADMIN: TEST ACCESS GRANTS (FEATURE 2)
# ===================================

@app.route('/api/admin/tests/<test_id>/grant-access', methods=['POST'])
@require_auth
def grant_test_access(test_id):
    """Grant test access to specific users"""
    try:
        data = request.json
        user_ids = data.get('userIds', [])
        
        if not user_ids:
            return jsonify({'error': 'No user IDs provided'}), 400
        
        # Get test details
        test_doc = db.collection('tests').document(test_id).get()
        if not test_doc.exists:
            return jsonify({'error': 'Test not found'}), 404
        
        test_data = test_doc.to_dict()
        test_name = test_data.get('name', 'Test')
        
        grants_created = 0
        grants_updated = 0
        
        for user_id in user_ids:
            # Get user details
            user_doc = db.collection('users').document(user_id).get()
            if not user_doc.exists:
                continue
            
            user_data = user_doc.to_dict()
            user_name = user_data.get('name', 'Unknown')
            user_email = user_data.get('email', '')
            
            # Check if grant already exists
            existing_grants = list(db.collection('testAccessGrants')
                .where('userId', '==', user_id)
                .where('testId', '==', test_id)
                .limit(1)
                .stream())
            
            if existing_grants:
                # Re-activate existing grant
                grant_doc = existing_grants[0]
                grant_doc.reference.update({
                    'isActive': True,
                    'grantedBy': request.uid,
                    'grantedByName': request.admin_data.get('name', 'Admin'),
                    'grantedAt': datetime.now(),
                    'updatedAt': datetime.now()
                })
                grants_updated += 1
            else:
                # Create new grant
                db.collection('testAccessGrants').add({
                    'userId': user_id,
                    'userName': user_name,
                    'userEmail': user_email,
                    'testId': test_id,
                    'testName': test_name,
                    'grantedBy': request.uid,
                    'grantedByName': request.admin_data.get('name', 'Admin'),
                    'grantedAt': datetime.now(),
                    'createdAt': datetime.now(),
                    'updatedAt': datetime.now(),
                    'isActive': True
                })
                grants_created += 1
        
        print(f"✅ Access granted: {grants_created} new, {grants_updated} updated for test {test_id}")
        
        return jsonify({
            'message': f'Access granted to {len(user_ids)} user(s)',
            'grantsCreated': grants_created,
            'grantsUpdated': grants_updated
        }), 200
        
    except Exception as e:
        print(f"❌ Error granting test access: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/api/admin/tests/<test_id>/revoke-access', methods=['POST'])
@require_auth
def revoke_test_access(test_id):
    """Revoke test access from specific users"""
    try:
        data = request.json
        user_ids = data.get('userIds', [])
        
        if not user_ids:
            return jsonify({'error': 'No user IDs provided'}), 400
        
        revoked_count = 0
        
        for user_id in user_ids:
            # Delete all grants for this user-test combination
            grants = list(db.collection('testAccessGrants')
                .where('userId', '==', user_id)
                .where('testId', '==', test_id)
                .stream())
            
            for grant_doc in grants:
                grant_doc.reference.delete()
                revoked_count += 1
        
        print(f"✅ Access revoked: {revoked_count} grant(s) for test {test_id}")
        
        return jsonify({
            'message': f'Access revoked from {len(user_ids)} user(s)',
            'revokedCount': revoked_count
        }), 200
        
    except Exception as e:
        print(f"❌ Error revoking test access: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.route('/api/admin/tests/<test_id>/access-list', methods=['GET'])
@require_auth
def get_test_access_list(test_id):
    """Get list of users who have been granted access to a test"""
    try:
        grants_query = db.collection('testAccessGrants') \
            .where('testId', '==', test_id) \
            .where('isActive', '==', True)
        
        grants = []
        for doc in grants_query.stream():
            grant_data = doc.to_dict()
            grant_data['id'] = doc.id
            
            # Convert timestamps
            for field in ['grantedAt', 'createdAt', 'updatedAt']:
                if field in grant_data and hasattr(grant_data[field], 'isoformat'):
                    grant_data[field] = grant_data[field].isoformat()
            
            grants.append(grant_data)
        
        print(f"✅ Fetched {len(grants)} access grants for test {test_id}")
        
        return jsonify(grants), 200
        
    except Exception as e:
        print(f"❌ Error fetching access list: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

# ===================================
# MATERIALS ENDPOINTS
# ===================================

@app.route('/api/student/materials', methods=['GET'])
@require_student_auth
def get_student_materials():
    """Get all study materials accessible to the student"""
    try:
        subject = request.args.get('subject')
        chapter = request.args.get('chapter')
        file_type = request.args.get('type')
        
        # Build query
        materials_ref = db.collection('materials').order_by('uploadedAt', direction=firestore.Query.DESCENDING)
        
        if subject:
            materials_ref = materials_ref.where('subject', '==', subject)
        if chapter:
            materials_ref = materials_ref.where('chapter', '==', chapter)
        if file_type:
            materials_ref = materials_ref.where('fileType', '==', file_type)
        
        materials = []
        user_data = request.user_data
        
        for doc in materials_ref.stream():
            material_data = doc.to_dict()
            material_data['id'] = doc.id
            
            # Check access
            has_access = check_user_access(
                user_data,
                material_data.get('subject'),
                material_data.get('access', 'premium')
            )
            
            material_data['hasAccess'] = has_access
            
            # Don't send file URL if no access
            if not has_access:
                material_data.pop('fileUrl', None)
            
            materials.append(material_data)
        
        return jsonify(materials), 200
        
    except Exception as e:
        print(f"❌ Error fetching student materials: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/student/materials/<material_id>', methods=['GET'])
@require_student_auth
def get_student_material(material_id):
    """Get single material with download URL"""
    try:
        material_ref = db.collection('materials').document(material_id)
        material_doc = material_ref.get()
        
        if not material_doc.exists:
            return jsonify({'error': 'Material not found'}), 404
        
        material_data = material_doc.to_dict()
        material_data['id'] = material_doc.id
        
        # Check access
        has_access = check_user_access(
            request.user_data,
            material_data.get('subject'),
            material_data.get('access', 'premium')
        )
        
        if not has_access:
            return jsonify({
                'error': 'Access denied',
                'message': f'Subscribe to {material_data.get("subject")} to access this material'
            }), 403
        
        # Update download count
        material_ref.update({
            'downloads': firestore.Increment(1)
        })
        
        return jsonify(material_data), 200
        
    except Exception as e:
        print(f"❌ Error fetching material: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# DOUBTS ENDPOINTS
# ===================================

@app.route('/api/student/doubts', methods=['GET'])
@require_student_auth
def get_my_doubts():
    """Get current user's doubts"""
    try:
        doubts_ref = db.collection('doubts')\
            .where('userId', '==', request.uid)\
            .order_by('createdAt', direction=firestore.Query.DESCENDING)
        
        doubts = []
        for doc in doubts_ref.stream():
            doubt_data = doc.to_dict()
            doubt_data['id'] = doc.id
            doubts.append(doubt_data)
        
        return jsonify(doubts), 200
        
    except Exception as e:
        print(f"❌ Error fetching doubts: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/student/doubts', methods=['POST'])
@require_student_auth
def submit_doubt():
    """Submit a new doubt"""
    try:
        data = request.json
        
        # Validate
        if not data.get('question') or not data.get('chapter'):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Create doubt
        doubt_data = {
            'userId': request.uid,
            'userName': request.user_data.get('displayName', 'Student'),
            'userEmail': request.user_data.get('email'),
            'chapter': data.get('chapter'),
            'question': data.get('question'),
            'status': 'pending',
            'response': None,
            'respondedBy': None,
            'respondedByName': None,
            'respondedAt': None,
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        
        doc_ref = db.collection('doubts').add(doubt_data)
        
        # Update user progress
        user_ref = db.collection('users').document(request.uid)
        user_ref.update({
            'progress.doubtsAsked': firestore.Increment(1)
        })
        
        return jsonify({
            'id': doc_ref[1].id,
            'message': 'Doubt submitted successfully'
        }), 201
        
    except Exception as e:
        print(f"❌ Error submitting doubt: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# USER PROFILE ENDPOINTS
# ===================================

@app.route('/api/student/profile', methods=['GET'])
@require_student_auth
def get_my_profile():
    """Get current user's profile"""
    try:
        user_ref = db.collection('users').document(request.uid)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({'error': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        user_data['id'] = user_doc.id
        
        return jsonify(user_data), 200
        
    except Exception as e:
        print(f"❌ Error fetching profile: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/student/profile', methods=['PUT'])
@require_student_auth
def update_my_profile():
    """Update current user's profile"""
    try:
        data = request.json
        
        # Only allow updating certain fields
        allowed_fields = ['displayName', 'phone', 'photoURL']
        update_data = {k: v for k, v in data.items() if k in allowed_fields}
        
        if not update_data:
            return jsonify({'error': 'No valid fields to update'}), 400
        
        update_data['updatedAt'] = firestore.SERVER_TIMESTAMP
        
        user_ref = db.collection('users').document(request.uid)
        user_ref.update(update_data)
        
        return jsonify({'message': 'Profile updated successfully'}), 200
        
    except Exception as e:
        print(f"❌ Error updating profile: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/student/subscriptions', methods=['GET'])
@require_student_auth
def get_my_subscriptions():
    """Get user's active subscriptions"""
    try:
        user_data = request.user_data
        subscriptions = user_data.get('subscriptions', [])
        
        return jsonify(subscriptions), 200
        
    except Exception as e:
        print(f"❌ Error fetching subscriptions: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/users/<user_id>/attempts', methods=['GET'])
@require_auth
def get_user_test_attempts(user_id):
    """Fetch all test attempts for a specific user, for the admin panel."""
    try:
        attempts_query = db.collection('testAttempts') \
            .where('userId', '==', user_id) \
            .order_by('submittedAt', direction=firestore.Query.DESCENDING)

        attempts = []
        for doc in attempts_query.stream():
            attempt_data = doc.to_dict()
            attempt_data['id'] = doc.id
            
            # Convert timestamp to ISO string
            if attempt_data.get('submittedAt') and hasattr(attempt_data['submittedAt'], 'isoformat'):
                attempt_data['submittedAt'] = attempt_data['submittedAt'].isoformat()
                
            attempts.append(attempt_data)

        print(f"✅ Fetched {len(attempts)} attempts for user: {user_id}")
        return jsonify(attempts), 200

    except Exception as e:
        print(f"❌ Error fetching user test attempts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/student/progress', methods=['GET'])
@require_student_auth
def get_my_progress():
    """Get user's progress stats"""
    try:
        user_data = request.user_data
        progress = user_data.get('progress', {
            'videosWatched': 0,
            'testsAttempted': 0,
            'doubtsAsked': 0,
            'totalWatchTime': 0
        })
        
        return jsonify(progress), 200
        
    except Exception as e:
        print(f"❌ Error fetching progress: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ===================================
# RUN SERVER
# ===================================

if __name__ == '__main__':
    host = os.getenv('FLASK_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    print(f"\n{'='*60}")
    print(f"🚀 GeoCatalyst Admin API Server")
    print(f"{'='*60}")
    print(f"📍 Host: {host}")
    print(f"🔌 Port: {port}")
    print(f"🐛 Debug: {debug}")
    print(f"📦 Max Upload Size: {app.config['MAX_CONTENT_LENGTH'] // (1024*1024)}MB")
    print(f"🔥 Firebase Project: {os.getenv('FIREBASE_PROJECT_ID', 'Not set')}")
    print(f"☁️  Cloudflare Account: {CLOUDFLARE_ACCOUNT_ID or 'Not set'}")
    print(f"🌐 CORS Enabled: ✅")
    print(f"📤 TUS Proxy Endpoint: /api/tus-upload-endpoint")
    print(f"{'='*60}\n")
    
    app.run(host=host, port=port, debug=debug)