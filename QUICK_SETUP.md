# 🚀 Rychlý Setup Guide - JellyDownloader

## ⚠️ DŮLEŽITÉ: Repository vs Docker Image názvy

- **GitHub Repository:** `JellyDownloader` (s velkými písmeny) ✅
- **Docker Image:** `ghcr.io/patrikmana/jellydownloader` (MUSÍ být malá písmena) ✅
- **Důvod:** GitHub Container Registry vyžaduje lowercase pro image názvy

---

## 📋 Krok za krokem

### 1️⃣ Vytvoř GitHub Repository

1. Jdi na: **https://github.com/new**
2. **Repository name:** `JellyDownloader` (přesně s velkými písmeny!)
3. **Visibility:** ✅ Public
4. ❌ **NEZAŠKRTÁVEJ** README, .gitignore, license
5. Klikni **Create repository**

---

### 2️⃣ Push kód

Otevři Command Prompt / PowerShell:

```cmd
cd c:\Users\Patrik\Desktop\prehrajto-downloader

# Přidej Git remote
git remote add origin https://github.com/patrikmana/JellyDownloader.git

# Nebo pokud už existuje, změň URL
git remote set-url origin https://github.com/patrikmana/JellyDownloader.git

# Commit všechny změny
git add .
git commit -m "Initial commit with Docker and CasaOS support"

# Push
git branch -M main
git push -u origin main
```

**Při zadávání hesla:**
- Username: `patrikmana`
- Password: **Použij Personal Access Token** (ne heslo!)
  - Vytvoř token na: https://github.com/settings/tokens
  - Scope: `repo`, `write:packages`, `read:packages`

---

### 3️⃣ Nastav GitHub Actions Permissions

1. Jdi na: **https://github.com/patrikmana/JellyDownloader/settings/actions**
2. Scrolluj dolů na **"Workflow permissions"**
3. Vyber: ✅ **"Read and write permissions"**
4. Zaškrtni: ✅ **"Allow GitHub Actions to create and approve pull requests"**
5. Klikni **Save**

---

### 4️⃣ Sleduj Build

1. Jdi na: **https://github.com/patrikmana/JellyDownloader/actions**
2. Workflow **"Build and Push Docker Image"** by měl běžet
3. Čekej **~5-10 minut** na dokončení
4. Po dokončení uvidíš ✅ zelený checkmark

**Pokud build selže:**
- Klikni na červený ❌ pro detail
- Nejčastější problém: Chybějící permissions (viz Krok 3)

---

### 5️⃣ Nastav Package jako Public

Po úspěšném buildu:

1. Jdi na: **https://github.com/patrikmana?tab=packages**
2. Klikni na package **`jellydownloader`** (bude malými písmeny)
3. Vpravo klikni **Package settings**
4. Scrolluj dolů na **"Danger Zone"**
5. Klikni **"Change visibility"**
6. Vyber **Public**
7. Potvrď napsáním: `jellydownloader`
8. Klikni **"I understand, change package visibility"**

---

### 6️⃣ Přidej Ikonu (volitelné)

```cmd
# Stáhni nebo vytvoř ikonu 512x512 PNG
# Ulož jako: app/icon.png

git add app/icon.png
git commit -m "Add app icon"
git push
```

---

### 7️⃣ Aktualizuj CasaOS App Store

V repository **patriks-casaos**:

1. Otevři: `Apps/JellyDownloader/docker-compose.yml`
2. Zkontroluj že URL jsou správně:
   - `icon: https://raw.githubusercontent.com/patrikmana/JellyDownloader/main/app/icon.png`
   - `thumbnail: https://raw.githubusercontent.com/patrikmana/JellyDownloader/main/app/icon.png`

**Už je správně nastaveno! ✅**

---

## 🎉 HOTOVO!

### Docker Image je dostupný jako:
```
ghcr.io/patrikmana/jellydownloader:latest
```

**Poznámka:** Image název je **malými písmeny**, i když repository je `JellyDownloader`!

---

### 🔧 Testování lokálně

```cmd
# Pull image
docker pull ghcr.io/patrikmana/jellydownloader:latest

# Spusť kontejner
docker run -d \
  --name jellydownloader-test \
  -p 6565:6565 \
  -e OMDB_API_KEY=tvuj_api_key \
  ghcr.io/patrikmana/jellydownloader:latest

# Otevři: http://localhost:6565

# Zastavení
docker stop jellydownloader-test
docker rm jellydownloader-test
```

---

### 📦 Instalace na CasaOS

**Možnost 1 - Z vlastního App Store:**
1. V CasaOS → App Store → Settings (ozubené kolo)
2. Přidej App Store URL:
   ```
   https://github.com/patrikmana/patriks-casaos/archive/refs/heads/main.zip
   ```
3. Refresh a najdi **JellyDownloader**

**Možnost 2 - Custom Install:**
1. V CasaOS → Custom Install
2. Zkopíruj obsah `app/docker-compose.yml`
3. Paste a klikni Install

---

## ❗ Troubleshooting

### ❌ "failed to solve: failed to compute cache key"
→ Dockerfile chyba, byla opravena. Push nový Dockerfile a znovu build.

### ❌ "permission denied" při buildu
→ Nastav Workflow permissions (Krok 3)

### ❌ Package nejde stáhnout (403 Forbidden)
→ Nastav package jako Public (Krok 5)

### ❌ CasaOS říká "replace YOUR_GITHUB_USERNAME"
→ To už je opraveno! Ujisti se že používáš správný docker-compose.yml z `app/` složky.

### ❌ Image nejde pullnout
→ Docker image MUSÍ být lowercase: `ghcr.io/patrikmana/jellydownloader:latest`

---

## 📞 Potřebuješ pomoct?

Pošli mi:
1. Screenshot z GitHub Actions
2. Chybovou hlášku
3. Který krok ti nejde

🚀 Všechno by teď mělo fungovat!
