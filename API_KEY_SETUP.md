# 🔑 RYCHLÝ NÁVOD - Nastavení API klíče

## Krok 1: Získejte OMDB API klíč (ZDARMA)

1. Jděte na: **http://www.omdbapi.com/apikey.aspx**
2. Vyberte **"FREE! (1,000 daily limit)"**
3. Zadejte váš email
4. Zkontrolujte email a **potvrďte** aktivaci
5. **Zkopírujte API klíč** z emailu

## Krok 2: Vložte klíč do aplikace

Otevřete soubor `.env` v hlavní složce projektu a **nahraďte** `your-api-key-here` vaším skutečným klíčem:

```env
OMDB_API_KEY=abc123xyz789  # <-- Váš skutečný klíč
```

**Příklad:**
```env
OMDB_API_KEY=3f8a1b2c
```

## Krok 3: Spusťte aplikaci

```bash
npm start
```

## ✅ Hotovo!

Aplikace nyní bude automaticky získávat správné IMDB metadata pro všechny filmy a seriály!

---

## 🔍 Kontrola, zda to funguje

Když spustíte `npm start`, měli byste vidět:

```
🚀 Prehrajto Downloader server běží na http://localhost:3000
📁 Statické soubory se servírují z 'public' složky
📥 Downloads adresář: /path/to/downloads
🎬 IMDB API: ACTIVE  <-- Toto znamená, že klíč funguje!
```

Pokud vidíte `MOCK MODE`, klíč není správně nastavený.

---

## 🆓 Bez API klíče?

Aplikace funguje i bez klíče, ale:
- ❌ Bez správných IMDB metadat
- ❌ Bez posterů a popisů
- ❌ Jellyfin nemusí filmy správně identifikovat

**Proto doporučujeme nastavit API klíč!** Je to zdarma a trvá to 2 minuty.

---

## � (Volitelné) TMDB API - České názvy seriálů

Pro automatické vyhledávání seriálů pod českými názvy na prehrajto.cz:

1. Jděte na: **https://www.themoviedb.org/settings/api**
2. Vytvořte účet (zdarma)
3. Požádejte o API klíč (Developer)
4. Zkopírujte API klíč (v3 auth)

V `.env` souboru přidejte:

```env
TMDB_API_KEY=your-tmdb-api-key-here
```

**Příklad:**
```env
OMDB_API_KEY=3f8a1b2c
TMDB_API_KEY=abc123def456789
```

S TMDB API klíčem aplikace automaticky najde české názvy seriálů (např. "Gilmore Girls" → "Gilmorova děvčata").

---

## �🎯 (Volitelné) Nastavení Jellyfin adresáře

V `.env` souboru můžete také nastavit cestu k Jellyfin knihovně:

```env
OMDB_API_KEY=your-api-key-here
JELLYFIN_DIR=/path/to/jellyfin/media  # <-- Přidejte tuto řádku
```

**Příklad pro macOS:**
```env
JELLYFIN_DIR=/Users/jakub/jellyfin/media
```

Pak se filmy budou stahovat **přímo** do Jellyfin knihovny!
