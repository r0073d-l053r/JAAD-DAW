# Firebase Security Deploy Checklist

The repository ships security rules and anonymous-auth code, but **none of it
is active until these console/CLI steps are done**. Until then, production
Firestore and Storage accept reads/writes from anyone.

## 1. Enable Anonymous Authentication (console, ~1 min)

1. Open [Firebase Console](https://console.firebase.google.com) → your project.
2. **Build → Authentication → Sign-in method**.
3. Enable the **Anonymous** provider and save.

Without this, `signInAnonymously()` fails silently and every cloud write is
rejected once the rules below are deployed.

## 2. Deploy the security rules (CLI, ~1 min)

```bash
npx firebase-tools deploy --only firestore:rules,storage
```

This activates [firestore.rules](../firestore.rules) (owner-write /
link-read with legacy-claim) and [storage.rules](../storage.rules)
(auth-required writes).

## 3. Mark demo projects as public (console, ~2 min)

The project browser only lists a user's own projects plus public templates.
For each demo project document in **Firestore → projects** (e.g. the
"Fractured Protocol" / "KAELO" demos), add the field:

```
isPublic : true   (boolean)
```

Without this, demos disappear from the hosted build's project browser
(deep links still work).

## 4. Storage CORS (CLI, one-time — see [firebase-cors.md](firebase-cors.md))

```bash
gsutil cors set cors.json gs://YOUR_BUCKET_NAME
```

Skipping this doesn't break the app (it falls back to a slower download
path) but direct streamed downloads are faster.

## Verify

- Open the hosted build in a private window → DevTools console should show a
  successful anonymous sign-in, and the demo project should appear in the
  project browser.
- Attempt to overwrite someone else's project document from the console →
  should be rejected with `PERMISSION_DENIED`.
