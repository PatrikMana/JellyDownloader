# Prehrajto Stahování

 Webová aplikace pro vyhledávání a stahování filmů ze serveru prehrajto.cz

##  Funkce

- **Vyhledávání filmů a seriálů** - jednoduché zadání názvu
- **Filtrování podle jazyka** - čeština, slovenština, angličtina, dabing, titulky
- **Řazení podle velikosti** - od největších, nejmenších, nebo střední velikost první
- **Konfigurovatelné štítky** - zobrazení kvality a velikosti souborů
- **Přehrávání videa** - přímý přístup k video souborům  
- **Responzivní rozhraní** - funguje na mobilu i desktopu
- **Rychlé načítání** - optimalizovaná API volání

##  Instalace

1. **Nainstaluj Node.js dependencies:**
```bash
npm install
```

2. **Spusť aplikaci:**
```bash
npm start
```

3. **Pro development (auto-reload):**
```bash
npm run dev
```

4. **Otevři v prohlížeči:**
```
http://localhost:3000
```

##  Technologie

- **Backend:** Node.js + Express.js
- **Scraping:** Axios + Cheerio  
- **Frontend:** Vanilla JavaScript + Bootstrap 5
- **Icons:** Font Awesome 6

##  Struktura projektu

```
prehrajto-downloader/
 server.js           # Node.js server
 package.json        # Dependencies
 public/
    index.html      # Hlavní stránka
    app.js          # Frontend JavaScript
    style.css       # Custom CSS
 README.md           # Dokumentace
```

##  API Endpointy

- `GET /api/search/:searchTerm` - Vyhledávání filmů
- `GET /api/video/:moviePath` - Získání video URL

##  Použití

1. Zadej název filmu do vyhledávacího pole
2. Klikni na "Hledat" 
3. Vyber film ze seznamu výsledků
4. Video se otevře v modálním okně
5. Můžeš ho přehrát přímo nebo stáhnout

##  Vlastnosti

- **Rychlé vyhledávání** - méně než 2 sekundy
- **Přímý přístup** - žádné reklamy ani přesměrování  
- **Mobilní design** - funguje na všech zařízeních
- **Copy-paste odkazy** - jednoduché sdílení

## To-Do:

1. Opravit pojmenování souborů - viz jellyfin guide
2. Odstranit dodatečné info soubory
3. Opravit stahování seriálů - dodat IMDB api a nedělat scraping toho
4. Stahování souborů přímo přes server
5. Výběr kvality
