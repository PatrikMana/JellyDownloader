# Jak funguje logika stahování z Prehrajto v tomhle projektu

Tenhle dokument popisuje, jak v aktuálním projektu funguje tok dat od vyhledání filmu až po stažení souboru na disk, a co z toho dává smysl zachovat pro novou aplikaci, která bude umět pouze přehrávání.

## Stručné shrnutí

V projektu jsou oddělené dvě hlavní vrstvy:

1. `resolve streamu`
   Cílem je najít na `prehrajto.cz` detail videa a z HTML stránky vytáhnout přímé URL na video soubor nebo více kvalit.

2. `download vrstva`
   Cílem je vzít už nalezené přímé `videoUrl`, stáhnout ho přes backend, ukládat na disk, hlásit progress přes SSE a pojmenovat soubor podle Jellyfin logiky.

Pro viewer-only aplikaci potřebuješ primárně jen první vrstvu.

## Architektura v aktuálním repu

Hlavní backend části:

- `server/routes/search.js`
- `server/routes/video.js`
- `server/routes/download.js`
- `server/services/prehrajto.js`
- `server/services/downloader.js`
- `server/utils/jobs.js`

Hlavní frontend části:

- `frontend/src/components/MovieMode.jsx`
- `frontend/src/components/QualityModal.jsx`
- `frontend/src/context/DownloadContext.jsx`

## Tok dat: vyhledání filmu

### 1. Frontend pošle hledání na backend

Ve `MovieMode.jsx` se po submitu formuláře volá:

- `searchApi.searchPrehrajto(searchQuery)`

To jde na endpoint:

- `GET /api/search/:searchTerm`

Implementace:

- `server/routes/search.js`

### 2. Backend stáhne HTML výsledků hledání

Funkce:

- `server/services/prehrajto.js -> search(searchTerm)`

Co dělá:

- postaví URL `https://prehrajto.cz/hledej/<dotaz>`
- udělá `axios.get(...)`
- načte HTML
- přes `cheerio` projde výsledky

Z každé nalezené položky vytáhne:

- `href`
- `title`
- `imageSrc`
- `duration`
- `size`
- `durationNumeric`
- `sizeNumeric`

Důležitý detail:

- `href` v této fázi není přímé video URL
- je to jen cesta na detail videa, typicky něco jako `/video/...`

To znamená, že samotné vyhledání ještě nestačí ani pro přehrání, ani pro stažení.

## Tok dat: získání skutečného video URL

Tohle je klíčová část celé logiky.

### 1. Frontend si vybere konkrétní položku

Když uživatel klikne na:

- `Náhled`
- nebo `Stáhnout`

frontend si vezme `movie.href` a zavolá:

- `GET /api/video/:moviePath`

Implementace:

- `server/routes/video.js`

### 2. Backend otevře detail videa na Prehrajto

Funkce:

- `server/services/prehrajto.js -> getVideoDetails(videoPath)`

Co dělá:

- složí URL `https://prehrajto.cz/<videoPath>`
- stáhne HTML detailu videa
- snaží se z HTML vytáhnout skutečné stream/source URL

### 3. Z HTML se hledá přímý source

Projekt používá tři postupy za sebou:

#### Metoda 1: `var sources = [...]`

Primární cesta je najít v HTML JavaScript pole:

```js
var sources = [...]
```

Kód:

- najde pole regexem
- převede ho přes `new Function('return ' + sourcesArrayText)()` na JS objekt
- z každé položky vezme `item.file` nebo `item.src`

Pak se snaží určit kvalitu:

- přímo z `item.res`
- nebo z `item.quality`
- nebo heuristikou podle URL
- případně fallbackem podle pořadí položky

Nakonec:

- odfiltruje jen validní `http` URL
- seřadí kvality od nejvyšší po nejnižší
- první položku vrátí jako výchozí `videoUrl`

#### Metoda 2: Playerjs config

Když `sources` nejsou k dispozici, zkouší se:

```js
new Playerjs({...})
```

Odtud se tahá `file`, které může být:

- jedna URL
- nebo formát s více kvalitami typu `[720p]url,[1080p]url`

I tady se z toho sestaví pole `qualities`.

#### Metoda 3: regex fallback

Když selžou obě předchozí možnosti, hledají se v HTML přímo URL na soubory:

- `.mp4`
- `.mkv`
- `.avi`
- `.webm`

Pokud se něco najde, použije se to jako defaultní `videoUrl`.

### 4. Výsledek endpointu `/api/video`

Backend vrací:

```json
{
  "success": true,
  "videoUrl": "https://...",
  "qualities": [
    { "src": "https://...", "res": 1080, "label": "1080p" },
    { "src": "https://...", "res": 720, "label": "720p" }
  ],
  "sourceUrl": "https://prehrajto.cz/video/..."
}
```

Tohle je přesně ten moment, kdy se z položky hledání stává přehratelné video.

## Tok dat: jak funguje samotné stahování

Jakmile už je známé přímé `videoUrl`, nastupuje downloader vrstva.

### 1. Frontend zavolá `/api/download`

Ve `DownloadContext.jsx` je `startDownload(...)`.

Ta funkce:

- vezme `item.videoUrl`, pokud už existuje
- pokud neexistuje, sama si ještě jednou zavolá `/api/video/...`
- pak pošle POST na `/api/download`

Body obsahuje hlavně:

- `videoUrl`
- `title`
- `imdbData`
- `type`
- `season`
- `episode`

### 2. Backend založí download job

Implementace:

- `server/routes/download.js`
- `server/services/downloader.js -> downloadFile(...)`

Co se stane:

- vytvoří se `job`
- vygeneruje se `jobId`
- download běží na pozadí
- klient okamžitě dostane `jobId`

### 3. Download běží jako stream přes backend

Skutečné stahování dělá:

- `server/services/downloader.js -> processDownload(...)`

Flow:

- určí extension souboru podle URL
- vytvoří cílovou složku
- vygeneruje Jellyfin-friendly filename
- otevře HTTP request na `videoUrl`
- použije `responseType: 'stream'`
- stream pipeuje do `fs.createWriteStream(...)`

Použité request headery jsou důležité:

- `User-Agent`
- `Referer: https://prehrajto.cz/`
- `Accept: */*`

Ten `Referer` může být důležitý, protože některé servery bez něj přímý request na video nepustí.

### 4. Průběh se hlásí přes SSE

Po dobu stahování backend průběžně počítá:

- `downloadedBytes`
- `totalBytes`
- `progress`
- `speedBps`
- `etaSec`

Tyto informace posílá do job emitteru.

Endpoint:

- `GET /api/download/progress/:jobId`

Vrací Server-Sent Events.

Frontend si otevře:

```js
new EventSource(`/api/download/progress/${downloadId}`)
```

a aktualizuje download HUD.

### 5. Cancel a cleanup

Součástí downloader vrstvy je i:

- zrušení přes `AbortController`
- mazání rozpracovaného souboru při chybě
- cleanup jobů po čase
- odstraňování prázdných adresářů

Tohle všechno je čistě download concerns, ne playback concerns.

## Kde je v projektu už dnes viewer logika

Viewer logika už v projektu částečně existuje.

Ve `MovieMode.jsx`:

- `handlePreview(...)`
- `handlePreviewSelect(...)`

Flow náhledu:

1. frontend zavolá `/api/video/<path>`
2. načte `qualities`
3. uživatel vybere kvalitu
4. zavolá se `window.open(selectedQuality.src, '_blank')`

To znamená:

- projekt už dnes umí vyřešit přehratelné URL
- preview a download se liší až v posledním kroku

Rozdíl je tedy jednoduchý:

- `preview`: otevře nebo přehraje `selectedQuality.src`
- `download`: pošle `selectedQuality.src` do backend downloaderu

## Co zachovat pro viewer-only aplikaci

### Zachovat

- `server/services/prehrajto.js`
- `server/routes/search.js`
- `server/routes/video.js`

Volitelně zachovat:

- `server/routes/imdb.js`
- `server/routes/tmdb.js`

To se hodí, pokud chceš:

- hezčí názvy
- poster
- rok
- rating
- doplňková metadata

### Vyhodit

- `server/services/downloader.js`
- `server/routes/download.js`
- `server/utils/jobs.js`
- `frontend/src/context/DownloadContext.jsx`
- `frontend/src/components/DownloadHUD.jsx`
- SSE progress logiku
- Jellyfin naming logiku
- filesystem logiku

## Doporučená architektura pro novou viewer-only app

### Varianta A: přímé přehrání source URL

Nejjednodušší varianta:

1. `GET /api/search/:query`
2. `GET /api/video/:path`
3. uživatel vybere kvalitu
4. frontend nastaví `<video src="selectedQuality.src">`

Výhody:

- nejjednodušší implementace
- minimum backendu

Nevýhody:

- může narazit na CORS
- může narazit na omezení `Range` requestů
- klient vidí přímé source URL

### Varianta B: backend stream proxy

Robustnější varianta:

1. frontend zavolá `/api/video/:path`
2. backend vrátí dostupné kvality
3. frontend vybere kvalitu
4. player nepoužije source URL přímo, ale třeba:

```text
/api/stream/<encoded-video-path>?quality=1080
```

nebo:

```text
/api/stream?src=<encoded-source-url>
```

Backend pak:

- otevře request na reálné `videoUrl`
- pošle správné headery
- stream přepošle klientovi

Výhody:

- obejdeš část CORS problémů
- klient nevidí původní source URL
- můžeš mít větší kontrolu nad requesty a headery

Nevýhody:

- větší zátěž na tvůj server
- musíš řešit `Range` requesty, pokud chceš funkční seekování ve videu

## Doporučený minimální backend pro viewer-only app

Pokud chceš opravdu malé řešení, backend může mít jen tyto endpointy:

### 1. Search

```text
GET /api/search/:query
```

Vrací seznam výsledků z Prehrajto.

### 2. Resolve video

```text
GET /api/video/:path
```

Vrací:

- `videoUrl`
- `qualities`
- `sourceUrl`

### 3. Optional stream proxy

```text
GET /api/stream/:path?quality=720
```

Nebo alternativně:

```text
GET /api/stream?src=<url>
```

Tenhle endpoint je potřeba jen pokud přímé přehrávání nebude spolehlivé.

## Doporučený minimální frontend pro viewer-only app

Frontend může být výrazně jednodušší než v downloader verzi.

Stačí:

1. search input
2. seznam výsledků
3. detail / modal s výběrem kvality
4. embedded player

Zachovat dává smysl:

- `QualityModal.jsx`
- část logiky z `MovieMode.jsx`

Naopak odstranit:

- multi-select pro download
- download HUD
- progress tracking
- cancel download

## Nejpodstatnější technické poznatky

### 1. Vyhledání a přehrání jsou dvě různé operace

`/api/search` nevrací přímé video URL.

Je vždy potřeba druhý krok:

- otevřít detail videa
- vytáhnout stream z HTML

### 2. Hlavní hodnota projektu je ve `prehrajto.getVideoDetails(...)`

To je nejdůležitější část celé aplikace.

Právě tam je know-how, jak:

- stáhnout detail stránky
- najít `sources`
- vytáhnout více kvalit
- vrátit přehratelné linky

### 3. Downloader je až následná vrstva

`downloader.js` neřeší, jak video najít.

Řeší jen:

- uložit ho na disk
- sledovat progress
- pojmenovat soubor
- uklidit rozpracované joby

### 4. Preview a viewer-only app mají skoro stejný základ

Současné `preview` už je velmi blízko tomu, co potřebuješ pro novou viewer-only app.

Rozdíl je hlavně v tom, že místo:

- `window.open(...)`

pravděpodobně budeš chtít:

- vlastní player page
- nebo `<video controls />`

## Praktický návrh migrace

Nejjednodušší cesta je novou aplikaci postavit takto:

1. zkopírovat `server/services/prehrajto.js`
2. ponechat `/api/search` a `/api/video`
3. zahodit celý download backend
4. na frontendu nechat search + quality picker
5. po výběru kvality otevřít interní player
6. pokud narazíš na CORS nebo seek problémy, přidat stream proxy endpoint

## Shrnutí pro rozhodnutí

Pokud chceš appku "jen viewer a ne stahování", tak z aktuálního projektu potřebuješ hlavně:

- scraping výsledků
- resolve přímého video URL
- quality selection
- player UI

Nepotřebuješ:

- download joby
- SSE progress
- Jellyfin naming
- filesystem zápis
- cancel logiku

Jinými slovy:

nejcennější část pro viewer-only app není downloader, ale resolver streamu v `server/services/prehrajto.js`.
