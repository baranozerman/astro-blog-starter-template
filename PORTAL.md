# Prodinox Müşteri Portalı

Müşterilerin giriş yapıp yalnızca izin verilen klasörlerdeki dosyaları görüntüleyip indirebildiği veya dosya yükleyebildiği portal.
Cloudflare Workers üzerinde çalışır: **D1** (kullanıcılar, klasörler, izinler, kayıtlar) ve **R2** (dosyalar).

## Özellikler

- E-posta + şifre ile giriş (PBKDF2 ile hashlenmiş şifreler, HttpOnly oturum çerezi, 7 gün)
- 5 hatalı denemede hesap 15 dakika kilitlenir
- Klasör bazlı izinler: **Görüntüle/indir** ve/veya **Yükle**
  - Sadece "Yükle" izni olan müşteri, klasörde yalnızca kendi yüklediği dosyaları görür
- Yönetici paneli (`/portal/admin`): kullanıcı ve klasör oluşturma, izin verme, şifre sıfırlama, hesabı pasifleştirme, son etkinlikler (giriş, yükleme, indirme, silme)
- Müşteriler kendi şifrelerini "Hesabım" sayfasından değiştirebilir
- Çapraz site form gönderimleri engellenir (CSRF); dosyalar her zaman indirme olarak sunulur (PDF/görseller isteğe bağlı önizlenir)

## Kurulum (Cloudflare)

```sh
npm install
npx wrangler login

# 1. Veritabanı ve dosya deposu oluşturun
npx wrangler d1 create prodinox-portal       # çıktıdaki database_id'yi wrangler.json'a yazın
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

## Sınırlar

- Tek yüklemede toplam en fazla ~95 MB (Cloudflare Workers istek boyutu sınırı).

## Dosya yapısı

- `migrations/` – D1 şeması
- `src/middleware.ts` – oturum kontrolü ve `/portal` koruması
- `src/lib/auth.ts` – şifre, giriş, oturum
- `src/lib/portal.ts` – izin kontrolleri ve yardımcılar
- `src/pages/portal/` – sayfalar (giriş, klasörler, indirme, yönetim)
