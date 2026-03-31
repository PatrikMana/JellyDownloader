# JellyDownloader

Webová aplikace pro vyhledávání a stahování filmů ze serveru prehrajto.cz **s automatickým pojmenováním pro Jellyfin**

## Funkce

-   **Vyhledávání filmů a seriálů** - jednoduché zadání názvu
-   **Filtrování podle jazyka** - čeština, slovenština, angličtina, dabing, titulky
-   **Řazení podle velikosti** - od největších, nejmenších, nebo střední velikost první
-   **Konfigurovatelné štítky** - zobrazení kvality a velikosti souborů
-   **Přehrávání videa** - přímý přístup k video souborům
-   **Responzivní rozhraní** - funguje na mobilu i desktopu
-   **Rychlé načítání** - optimalizovaná API volání
-   **🎬 JELLYFIN INTEGRACE** - automatické pojmenování a metadata pro Jellyfin
-   **📥 Server-side stahování** - stahování přímo přes server s progress barem
-   **🎭 IMDB metadata** - automatické získání informací z IMDB databáze
-   **📝 Automatické titulky** - integrace s titulky.com

## 🚀 Rychlý start pro Jellyfin

```bash
# 1. Nainstaluj závislostinpm install# 2. (Volitelné) Nastav OMDB API klíčexport OMDB_API_KEY="your-api-key"# 3. (Volitelné) Nastav Jellyfin adresářexport JELLYFIN_DIR="/path/to/jellyfin/media"# 4. Spusť servernpm start
```

**📖 Kompletní návod:** Viz [JELLYFIN_SETUP.md](./JELLYFIN_SETUP.md)

## Instalace

1.  **Nainstaluj Node.js dependencies:**

```bash
npm install
```

2.  **Spusť aplikaci:**

```bash
npm start
```

3.  **Pro development (auto-reload):**

```bash
npm run dev
```

4.  **Otevři v prohlížeči:**

```
http://localhost:3000
```

## Technologie

-   **Backend:** Node.js + Express.js
-   **Scraping:** Axios + Cheerio
-   **Frontend:** Vanilla JavaScript + Bootstrap 5
-   **Icons:** Font Awesome 6

## Struktura projektu

```
jellydownloader/ server.js           # Node.js server package.json        # Dependencies public/    index.html      # Hlavní stránka    app.js          # Frontend JavaScript    style.css       # Custom CSS README.md           # Dokumentace
```

## API Endpointy

### Základní

-   `GET /api/search/:searchTerm` - Vyhledávání filmů
-   `GET /api/video/:moviePath` - Získání video URL

### IMDB integrace

-   `GET /api/imdb/:title/:year?` - Získání IMDB dat pro film
-   `GET /api/imdb/series/search/:query` - Vyhledání seriálu v IMDB
-   `GET /api/imdb/series/:imdbId` - Detail seriálu včetně sezón

### Stahování

-   `POST /api/download` - Stažení souboru s Jellyfin pojmenováním
    -   Body: `{ videoUrl, title, imdbData, type, subtitles, season?, episode? }`
-   `GET /api/downloads` - Seznam stažených souborů
-   `DELETE /api/downloads/:filename` - Smazání staženého souboru

### Titulky

-   `GET /api/subtitles/:title/:year?` - Vyhledání titulků na titulky.com

## Použití

1.  Zadej název filmu do vyhledávacího pole
2.  Klikni na "Hledat"
3.  Vyber film ze seznamu výsledků
4.  **NOVÉ:** Klikni na "Stáhnout pro Jellyfin"
5.  Aplikace automaticky:
    -   Stáhne video soubor
    -   Získá IMDB metadata
    -   Vytvoří správnou složkovou strukturu
    -   Pojmenuje podle Jellyfin standardu
    -   Vytvoří .nfo soubor s metadaty
6.  Přesuň složku do Jellyfin knihovny (nebo nastav `JELLYFIN_DIR`)
7.  V Jellyfin spusť "Scan Library"

## 📁 Jellyfin struktura souborů

### Filmy

```
downloads/movies/└── Avatar (2009) [imdbid-tt0499549]/    ├── Avatar (2009) [imdbid-tt0499549].mp4    ├── Avatar (2009) [imdbid-tt0499549].cs.srt    └── Avatar (2009) [imdbid-tt0499549].nfo
```

### Seriály

```
downloads/tvshows/└── Breaking Bad [imdbid-tt0903747]/    └── Season 01/        ├── Breaking Bad [imdbid-tt0903747] - s01e01.mp4        └── Breaking Bad [imdbid-tt0903747] - s01e01.nfo
```

## Vlastnosti

-   **Rychlé vyhledávání** - méně než 2 sekundy
-   **Přímý přístup** - žádné reklamy ani přesměrování
-   **Mobilní design** - funguje na všech zařízeních
-   **Copy-paste odkazy** - jednoduché sdílení
-   **🎬 Jellyfin ready** - automatické pojmenování podle standardů
-   **📊 IMDB integrace** - metadata, postery, hodnocení
-   **📥 Server stahování** - progress bar a správa souborů
-   **🌍 Multi-jazyk** - podpora CZ, SK, EN titulků

## ⚙️ Konfigurace

### Environment variables:

```bash
OMDB_API_KEY=your-api-key        # OMDB API klíč (volitelné, default: mock mode)JELLYFIN_DIR=/path/to/jellyfin   # Cesta k Jellyfin knihovně (volitelné)PORT=3000                         # Server port (volitelné, default: 3000)
```

### Získání OMDB API klíče:

1.  Jděte na: [http://www.omdbapi.com/apikey.aspx](http://www.omdbapi.com/apikey.aspx)
2.  Vyberte FREE tier (1000 requests/day)
3.  Potvrďte email a zkopírujte klíč

## To-Do:

1. Opravit pojmenování souborů - viz jellyfin guide ✅ HOTOVO

2. Odstranit dodatečné info soubory ✅ HOTOVO (.nfo soubory jsou správně formátované)

3. Opravit stahování seriálů - dodat IMDB api a nedělat scraping toho ✅ HOTOVO

4. Stahování souborů přímo přes server ✅ HOTOVO

5. Výběr kvality - TODO

6. Batch stahování více filmů najednou - TODO

7. WebSocket progress updates pro real-time progress ✅ HOTOVO