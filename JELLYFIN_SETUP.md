# 🎬 Jellyfin Setup Guide

Tento návod vám pomůže nastavit automatické stahování filmů a seriálů s perfektním pojmenováním pro Jellyfin.

## 📋 Před spuštěním

### 1. Nainstalujte závislosti

```bash
npm install
```

### 2. (Volitelné) Nastavte OMDB API klíč

Pro získání správných IMDB metadat si vytvořte **bezplatný** API klíč:

1.  Jděte na: [http://www.omdbapi.com/apikey.aspx](http://www.omdbapi.com/apikey.aspx) -  [http://www.omdbapi.com/…5fa](http://www.omdbapi.com/…5fa "http://www.omdbapi.com/…5fa") (klic)
2.  Vyberte "FREE" tier (1,000 požadavků/den)
3.  Potvrďte email
4.  Zkopírujte API klíč

**Nastavení API klíče:**

```bash
export OMDB_API_KEY="váš-api-klíč"
```

Nebo v `.env` souboru (vytvořte ho):

```
OMDB_API_KEY=váš-api-klíč
```

> **Poznámka:** Bez API klíče aplikace funguje v MOCK módu s fiktivními IMDB daty.

### 3. (Volitelné) Nastavte Jellyfin adresář

Pokud chcete stahovat **přímo** do Jellyfin knihovny:

```bash
export JELLYFIN_DIR="/path/to/your/jellyfin/media"
```

Příklad pro macOS:

```bash
export JELLYFIN_DIR="/Users/username/jellyfin/media"
```

Příklad pro Linux:

```bash
export JELLYFIN_DIR="/media/jellyfin"
```

## 🚀 Spuštění

```bash
npm start
```

Aplikace poběží na: **[http://localhost:3000](http://localhost:3000)**

## 📂 Struktura souborů pro Jellyfin

### Filmy

Aplikace vytvoří strukturu:

```
downloads/movies/└── Avatar (2009) [imdbid-tt0499549]/    ├── Avatar (2009) [imdbid-tt0499549].mp4    ├── Avatar (2009) [imdbid-tt0499549].cs.srt    └── Avatar (2009) [imdbid-tt0499549].nfo
```

### Seriály

```
downloads/tvshows/└── Breaking Bad [imdbid-tt0903747]/    ├── Season 01/    │   ├── Breaking Bad [imdbid-tt0903747] - s01e01.mp4    │   ├── Breaking Bad [imdbid-tt0903747] - s01e01.cs.srt    │   └── Breaking Bad [imdbid-tt0903747] - s01e01.nfo    └── Season 02/        └── ...
```

## 🎯 Jak použít

### 1. Vyhledejte film/seriál

-   Zadejte název do vyhledávacího pole
-   Aplikace vyhledá na prehrajto.cz

### 2. Vyberte soubor

-   Zobrazí se seznam dostupných souborů
-   Můžete filtrovat podle:
    -   **Jazyka** (čeština, slovenština, angličtina)
    -   **Kvality** (1080p, 720p, 4K)
    -   **Velikosti**

### 3. Stáhněte

-   Klikněte na film
-   Aplikace automaticky:
    -   ✅ Stáhne video soubor
    -   ✅ Vyhledá IMDB metadata
    -   ✅ Vytvoří správnou složkovou strukturu
    -   ✅ Pojmenuje soubory podle Jellyfin standardu
    -   ✅ Stáhne titulky (pokud jsou dostupné)
    -   ✅ Vytvoří .nfo soubor s metadaty

### 4. Přidejte do Jellyfin

**Pokud jste nastavili JELLYFIN_DIR:**

-   Soubory jsou už na správném místě!
-   V Jellyfin: `Dashboard → Libraries → Scan Library`

**Pokud NEMÁTE nastavený JELLYFIN_DIR:**

1.  Soubory jsou ve složce: `downloads/`
2.  Přesuňte celou složku filmu do Jellyfin knihovny:
    
    ```bash
    # Příklad pro film:mv downloads/movies/Avatar (2009) [imdbid-tt0499549]/ /path/to/jellyfin/movies/# Příklad pro seriál:mv downloads/tvshows/Breaking Bad [imdbid-tt0903747]/ /path/to/jellyfin/tvshows/
    ```
    
3.  V Jellyfin: `Dashboard → Libraries → Scan Library`

## 📝 Jellyfin Naming Convention

Aplikace automaticky pojmenovává soubory podle [Jellyfin dokumentace](https://jellyfin.org/docs/general/server/media/movies/):

### Filmy:

```
Movie Title (Year) [imdbid-ttXXXXXXX].ext
```

### Seriály:

```
Series Name [imdbid-ttXXXXXXX] - sXXeYY - Episode Title.ext
```

### Výhody:

-   ✅ Automatická identifikace pomocí IMDB ID
-   ✅ Správné metadata (poster, popis, herci)
-   ✅ Automatické titulky
-   ✅ Perfektní organizace v Jellyfin

## 🔧 Troubleshooting

### "MOCK MODE" v konzoli

-   Nemáte nastavený OMDB_API_KEY
-   Aplikace funguje, ale používá fiktivní IMDB data
-   **Řešení:** Nastavte OMDB API klíč (viz výše)

### Soubory se nestahují

-   Zkontrolujte oprávnění ke složce `downloads/`
-   Zkontrolujte internetové připojení
-   Podívejte se do konzole: `npm start`

### Jellyfin nerozpozná film

1.  Zkontrolujte, zda má soubor správný formát názvu
2.  Ujistěte se, že `.nfo` soubor je vedle videa
3.  V Jellyfin spusťte: `Identify` na konkrétním filmu

### Video se nepřehrává v Jellyfin

-   Jellyfin možná potřebuje překódovat video
-   Nainstalujte FFmpeg na server s Jellyfin
-   Zkontrolujte podporované formáty v Jellyfin

## 📚 Další zdroje

-   [Jellyfin Dokumentace](https://jellyfin.org/docs/)
-   [Jellyfin Naming Guide](https://jellyfin.org/docs/general/server/media/movies/)
-   [OMDB API](http://www.omdbapi.com/)

## 🎉 Hotovo!

Nyní máte plně funkční downloader s automatickým pojmenováním pro Jellyfin!

Užívejte si své filmy a seriály! 🍿