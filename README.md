
# 📱 Aksha Mobile App — 

## Testing Guide

This guide explains how to **set up and test** the Fabric Mock App in development mode.

---

## 1️⃣ Clone the Repository

```bash
git clone https://github.com/algoanalytics-pvt/sharda-mobile-app-frontend
cd aksha-mobile-app-frontend
```

---

## 2️⃣ Set Up Environment

1. Copy `.env.development.example` to `.env.development`:

```bash
cp .env.development.example .env.development
```

2. Update the `.env.development` file:

```env
EXPO_PUBLIC_APP_TRADE_URL=http://localhost:5000
```

> This points the app to your **local backend** for testing.

---

## 3️⃣ Install Dependencies

```bash
npm install
```

---

## 4️⃣ Start the App (Development Mode)

```bash
npm start
```

* Scan the QR code with **Expo Go** on your mobile device, or run in an emulator.


# 📦 EAS Build Guide —  Mobile APP

This guide explains how to build the * Mobile App** for production using **EAS Build**. Create a account on expo go exo.dev

--- 

## 1️⃣ Prerequisites

* Make sure you have **Expo CLI** and **EAS CLI** installed:

```bash
npm install -g expo-cli eas-cli
```

* You must be **logged in to Expo**:

```bash
expo login
```

* Ensure the **project ID** is set correctly in `app.config.js` or `app.json`.

---

## 2️⃣ Production Build Command

Run the following command to build the app for **both Android and iOS**:

```bash
eas build --platform all --profile production --non-interactive
```

### Explanation:

* `--platform all` → Build for **iOS and Android**.
* `--profile production` → Use the **production profile** from `eas.json`.
* `--non-interactive` → Run the build **without prompts** (useful for CI/CD).

---

## ⚠️ Important Note

**Do NOT build without permission** from:

* @mridul\_sharma
* @prathamesh\_londhe
* @saurabh\_kadam

This ensures proper coordination and prevents unapproved builds.

---

## 3️⃣ Optional: Specify Output Folder

You can save build artifacts locally:

```bash
eas build --platform all --profile production --non-interactive --output ./builds
```

* This will store `.apk`, `.aab`, or `.ipa` files in the `./builds` folder.

---

✅ **Tip:** Always test changes in development mode before running a production build.

