1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project: **PROJECT_ID**.
3. Open the **Cloud Shell** (the `>_` icon in the top right).
4. Run these commands one by one:

```bash
# First, ensure you are logged in
gcloud auth login

# Create the configuration file
echo '[{"origin": ["*"], "method": ["GET", "HEAD"], "maxAgeSeconds": 3600}]' > cors.json

# Apply the CORS policy to your bucket (try both if one fails)
gcloud storage buckets update gs://PROJECT_ID.firebasestorage.app --cors-file=cors.json
gcloud storage buckets update gs://PROJECT_ID.appspot.com --cors-file=cors.json
```

### ⏳ Important: Propagation Time
CORS changes can take **up to 1 minute** to take effect. If you still see errors, wait 60 seconds and refresh your DAW page.

### 🛑 Still failing?
If the command says "Bucket not found", check your Firebase Console under **Storage** to see the exact bucket name (it's at the top of the file list). It should look like `gs://something.appspot.com`.

### Option 2: Using the Command Line (If you have gcloud/gsutil installed)

Run this in your terminal:
```bash
echo '[{"origin": ["*"], "method": ["GET"], "maxAgeSeconds": 3600}]' > cors.json
gsutil cors set cors.json gs://PROJECT_ID.firebasestorage.app
```

### Why is this happening?
By default, Firebase Storage buckets block "Cross-Origin" requests from web browsers for security. Since your app is running on `localhost:3000` and the files are on `firebasestorage.googleapis.com`, the browser requires a specific permission header from the server to allow the download.
