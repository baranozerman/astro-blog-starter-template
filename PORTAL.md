# Prodinox Müşteri Portalı

Müşterilerin giriş yapıp yalnızca izin verilen klasörlerdeki dosyaları görüntüleyip indirebildiği veya dosya yükleyebildiği portal.
Cloudflare Workers üzerinde çalışır: **D1** (kullanıcılar, klasörler, izinler, kayıtlar) ve **R2** (dosyalar).

## Özellikler

- E-posta + şifre ile giriş (PBKDF2 ile hashlenmiş şifreler, HttpOnly oturum çerezi, 7 gün)
- 5 hatalı denemede hesap 15 dakika kilitlenir
- Klasör bazlı izinler: **Görüntüle/indir** ve/veya **Yükle**
  - İzinler **ana klasörlere** verilir; alt klasörler bu izinleri devralır
  - Sadece "Yükle" izni olan müşteri, klasörde yalnızca kendi yüklediği dosyaları görür
- Dosya yöneticisi: sınırsız alt klasör, yeniden adlandırma, taşıma, toplu seçim ile taşı/sil, arama, sürükle-bırak yükleme
  - Yöneticiler her şeyi yönetir; müşteriler yalnızca kendi oluşturdukları klasör ve dosyaları (klasörleri yalnızca boşken silebilir)
  - Veritabanı şema güncellemeleri (ör. alt klasör desteği) uygulama açılırken otomatik uygulanır (`src/lib/schema.ts`)
- Yönetici paneli (`/portal/admin`): kullanıcı ve klasör oluşturma, izin verme, şifre sıfırlama, hesabı pasifleştirme, son etkinlikler (giriş, yükleme, indirme, silme)
- Müşteriler kendi şifrelerini "Hesabım" sayfasından değiştirebilir
- **Türkçe / İngilizce arayüz:** üst menüde ve giriş ekranında TR | EN seçici; seçim tarayıcıda hatırlanır.
  İlk ziyarette tarayıcı dili Türkçe ise Türkçe, değilse İngilizce açılır. Tüm metinler `src/lib/i18n.ts` içinde.
- Giriş ekranında ve üst menüde prodinox.com.tr bağlantısı
- Çapraz site form gönderimleri engellenir (CSRF); dosyalar her zaman indirme olarak sunulur (PDF/görseller isteğe bağlı önizlenir)

## Kurulum (Cloudflare)

```sh
npm install
npx wrangler login

# 1. Veritabanı ve dosya deposu oluşturun
npx wrangler d1 create prodinox-portal       # (zaten oluşturuldu; ID wrangler.json içinde)
npx wrangler r2 bucket create prodinox-portal-files

# 2. Tabloları oluşturun
npx wrangler d1 migrations apply DB --remote

# 3. İlk yönetici için kurulum anahtarı (uzun, rastgele bir değer)
npx wrangler secret put SETUP_TOKEN

# 4. Yayınlayın
npm run deploy
```

Ardından `https://<site>/portal/setup` adresine gidip kurulum anahtarıyla ilk yönetici hesabını oluşturun.
Bu sayfa, ilk kullanıcı oluşturulduktan sonra otomatik olarak kapanır.

## Yerel geliştirme

```sh
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply DB --local
npm run preview
```

## Kullanım

1. **Yönetim → Yeni klasör**: örn. her müşteri için bir klasör ("ACME – Teknik Çizimler").
2. **Yönetim → Yeni kullanıcı**: müşteri hesabı ve geçici şifre oluşturun.
3. Kullanıcının (veya klasörün) sayfasında hangi klasörde **Görüntüle** / **Yükle** izni olacağını işaretleyin.
4. Müşteriye portal adresini ve geçici şifresini iletin.

## Dosyaları kendi NAS'ımızda tutmak (Synology)

`WEBDAV_URL` tanımlıysa yeni yüklenen dosyalar R2 yerine şirket NAS'ına (WebDAV) kaydedilir.
NAS internete port açılmadan **Cloudflare Tunnel** ile bağlanır ve **Cloudflare Access** ile yalnızca portalın erişebileceği şekilde korunur.
Önceden R2'ye yüklenmiş dosyalar R2'de kalır ve indirilebilmeye devam eder.

### 1. Synology'de WebDAV
1. **Denetim Masası → Paylaşılan Klasör → Oluştur**: `portal` adında bir klasör.
2. **Denetim Masası → Kullanıcı → Oluştur**: örn. `portal-web` kullanıcısı. Yalnızca `portal` klasörüne **Okuma/Yazma** izni verin, diğer klasörlere **Erişim yok**.
3. **Paket Merkezi → WebDAV Server** paketini kurun, açıp **HTTP'yi etkinleştir** (port `5005`).
4. **Denetim Masası → Uygulama Ayrıcalıkları → WebDAV**: yalnızca `portal-web` kullanıcısına izin verin.

### 2. Cloudflare Tunnel (NAS'ı port açmadan bağlar)
1. Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, ad: `nas`.
2. Ortam olarak **Docker** seçin ve komuttaki token'ı kopyalayın.
3. Synology → **Container Manager → Kayıt** bölümünde `cloudflare/cloudflared` imajını indirin, şu ayarlarla çalıştırın:
   - Ağ: **host**
   - Komut: `tunnel --no-autoupdate run --token <TOKEN>`
   - Otomatik yeniden başlatma: açık
4. Tunnel'da **Public Hostname → Add**: Subdomain `nas`, Domain `prodinox.app`, Service `HTTP` → `localhost:5005`.

### 3. Cloudflare Access (NAS adresine yalnızca portal erişebilsin)
1. **Zero Trust → Access → Service Auth → Create Service Token**: ad `portal-worker`. **Client ID** ve **Client Secret**'ı kaydedin (Secret bir daha gösterilmez).
2. **Zero Trust → Access → Applications → Add an application → Self-hosted**: domain `nas.prodinox.app`.
3. Politika: Action **Service Auth**, Include → **Service Token** → `portal-worker`.

### 4. Worker ayarları
Worker → **Settings → Variables and Secrets**:

| Ad | Tür | Değer |
| --- | --- | --- |
| `WEBDAV_URL` | Text | `https://nas.prodinox.app/portal` |
| `WEBDAV_USER` | Text | `portal-web` |
| `WEBDAV_PASSWORD` | Secret | NAS kullanıcısının şifresi |
| `CF_ACCESS_CLIENT_ID` | Secret | Service token Client ID |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Service token Client Secret |

Kaydettikten sonra portala bir test dosyası yükleyin; NAS'ta `portal/<klasör no>/<tarih>_<kod>_<dosya adı>` olarak görünmelidir.

### Bilinmesi gerekenler
- NAS veya ofis interneti kapalıyken NAS'taki dosyalar indirilemez, yükleme yapılamaz (kullanıcıya açıklayıcı bir mesaj gösterilir).
- NAS'taki dosyaları elle **taşımayın veya yeniden adlandırmayın**; portal dosyayı bulamaz.
- NAS'a elle kopyalanan dosyalar portalda görünmez; portaldan yüklenmelidir.

## Görseller ve logo

- Logo: `public/brand/` (sunumdaki logodan vektörleştirildi; `logo-h-*` yatay, `logo-*` dikey, `mark-*` yalnız simge)
- Arka plan fotoğrafları: `public/backgrounds/` ve liste `src/lib/backdrops.ts`. Yeni fotoğraf eklemek için
  `<ad>.jpg` (~2400px) ve `<ad>-1200.jpg` dosyalarını koyup listeye bir satır ekleyin.

## Sınırlar

- Tek yüklemede toplam en fazla ~95 MB (Cloudflare Workers istek boyutu sınırı).

## Dosya yapısı

- `migrations/` – D1 şeması
- `src/middleware.ts` – oturum kontrolü ve `/portal` koruması
- `src/lib/auth.ts` – şifre, giriş, oturum
- `src/lib/portal.ts` – izin kontrolleri ve yardımcılar
- `src/pages/portal/` – sayfalar (giriş, klasörler, indirme, yönetim)
