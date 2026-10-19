import type { Lang } from "./i18n";

/**
 * Privacy notice (KVKK aydınlatma metni) and data-security summary shown at
 * /portal/privacy. Keep both languages in step; bump UPDATED on any change.
 */
export const PRIVACY_UPDATED = "2026-10-19";

export interface PrivacySection {
	h: string;
	p?: string[];
	list?: string[];
}

export const PRIVACY: Record<Lang, { title: string; lead: string; updated: string; sections: PrivacySection[] }> = {
	tr: {
		title: "Gizlilik ve veri güvenliği",
		lead: "Prodinox Müşteri Portalı'nda hangi verileri, neden işlediğimizi ve dosyalarınızı nasıl koruduğumuzu açıklıyoruz. Bu metin 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) 10. maddesi kapsamındaki aydınlatma metnidir.",
		updated: "Son güncelleme",
		sections: [
			{
				h: "Veri sorumlusu",
				p: [
					"Kişisel verileriniz veri sorumlusu sıfatıyla Prodinox tarafından işlenir. İletişim bilgilerimize prodinox.com.tr adresinden ulaşabilirsiniz.",
				],
			},
			{
				h: "İşlenen veriler",
				list: [
					"Hesap bilgileri: ad soyad, firma, e-posta adresi ve kullanıcı rolü.",
					"Şifre: yalnızca geri döndürülemez özeti (PBKDF2) saklanır; şifrenizi biz de göremeyiz.",
					"İşlem kayıtları: giriş, dosya yükleme, indirme, taşıma, silme ve izin değişikliklerinin kim tarafından ve ne zaman yapıldığı.",
					"Yüklenen dosyalar ve dosya adları. Dosyaların içeriğindeki kişisel veriler yükleyenin sorumluluğundadır.",
					"Güvenlik: hatalı giriş denemelerini sınırlamak için IP adresinizin geri döndürülemez özeti en fazla 15 dakika tutulur.",
				],
			},
			{
				h: "İşleme amaçları ve hukuki sebepler",
				list: [
					"Proje dosyalarının müşterilerimizle güvenli şekilde paylaşılması ve hesabınızın yönetilmesi — sözleşmenin kurulması ve ifası (KVKK m. 5/2-c).",
					"Erişimlerin kayıt altına alınması, yetkisiz erişimin önlenmesi ve olası olayların incelenmesi — hukuki yükümlülük ve meşru menfaat (KVKK m. 5/2-ç ve 5/2-f).",
				],
			},
			{
				h: "Verilerin saklandığı yer ve aktarım",
				p: [
					"Portal, Cloudflare, Inc. altyapısında çalışır. Hesap bilgileri ve işlem kayıtları Cloudflare veritabanında; dosyalar Cloudflare depolamasında veya Prodinox'un kendi dosya sunucusunda saklanır. Cloudflare sunucuları yurt dışında bulunabileceğinden bu durum KVKK'nın 9. maddesi kapsamında yurt dışına aktarım niteliğindedir.",
					"Verileriniz pazarlama veya reklam amacıyla kullanılmaz ve üçüncü kişilere satılmaz. Yasal zorunluluk halinde yetkili kamu kurumlarıyla paylaşılabilir.",
				],
			},
			{
				h: "Saklama süresi",
				p: [
					"Hesap bilgileri hesabınız açık olduğu sürece saklanır ve hesap silindiğinde silinir. Dosyalar proje süresince ve ilgili mevzuattaki saklama süreleri boyunca tutulur; süre sonunda silinir. İşlem kayıtları güvenlik ve ispat amacıyla makul bir süre saklanır.",
				],
			},
			{
				h: "Dosyalarınızı nasıl koruyoruz",
				list: [
					"Tüm bağlantılar HTTPS (TLS) ile şifrelenir; tarayıcıların şifresiz bağlantı kurması engellenir (HSTS).",
					"Cloudflare depolamasındaki dosyalar beklemede şifrelenmiş olarak tutulur.",
					"Her müşteri yalnızca kendisine yetki verilen klasörleri görebilir; yetkiler klasör bazında ayrı ayrı tanımlanır (görüntüleme / yükleme).",
					"Dosyalar herkese açık bir bağlantıyla paylaşılmaz; her indirme oturum ve yetki kontrolünden geçer ve kayda alınır.",
					"Art arda hatalı girişte hesap geçici olarak kilitlenir; aynı adresten çok sayıda deneme ayrıca sınırlandırılır.",
					"Oturumlar 7 gün sonra kendiliğinden sona erer; şifre değiştirildiğinde diğer cihazlardaki oturumlar kapatılır.",
					"Portal sayfaları tarayıcıda veya ara sunucularda önbelleğe alınmaz, başka sitelerin içine gömülemez.",
				],
			},
			{
				h: "Çerezler",
				list: [
					"prodinox_session — oturumunuzu açık tutar (zorunlu, en fazla 7 gün).",
					"prodinox_lang — dil tercihinizi hatırlar (1 yıl).",
					"İzleme, analiz veya reklam çerezi kullanılmaz; yazı tipleri de dahil hiçbir içerik üçüncü taraf sunuculardan yüklenmez.",
				],
			},
			{
				h: "Haklarınız",
				p: [
					"KVKK'nın 11. maddesi uyarınca; verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı kişileri bilme, eksik veya yanlış verilerin düzeltilmesini, silinmesini veya yok edilmesini isteme, bu işlemlerin aktarılan kişilere bildirilmesini isteme, otomatik analiz sonucu aleyhinize bir sonuca itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz.",
					"Başvurularınızı prodinox.com.tr üzerindeki iletişim kanallarından veya Prodinox'taki irtibat kişiniz aracılığıyla iletebilirsiniz. Başvurular en geç 30 gün içinde sonuçlandırılır.",
				],
			},
			{
				h: "Sizden ricamız",
				list: [
					"Şifrenizi kimseyle paylaşmayın; ortak bilgisayarlarda işiniz bitince çıkış yapın.",
					"Yalnızca projeyle ilgili dosyaları yükleyin ve dosyaların zararlı yazılım içermediğinden emin olun.",
					"Bir güvenlik sorunu fark ederseniz lütfen hemen Prodinox'a bildirin.",
				],
			},
		],
	},
	en: {
		title: "Privacy & data security",
		lead: "What data the Prodinox Customer Portal processes, why, and how your files are protected. This is the privacy notice under Article 10 of the Turkish Personal Data Protection Law No. 6698 (KVKK).",
		updated: "Last updated",
		sections: [
			{
				h: "Data controller",
				p: [
					"Your personal data is processed by Prodinox as data controller. Our contact details are available at prodinox.com.tr.",
				],
			},
			{
				h: "Data we process",
				list: [
					"Account details: full name, company, email address and user role.",
					"Password: only an irreversible hash (PBKDF2) is stored; nobody at Prodinox can see your password.",
					"Activity log: who signed in, uploaded, downloaded, moved or deleted files or changed permissions, and when.",
					"Uploaded files and file names. Personal data inside files is the responsibility of the uploader.",
					"Security: an irreversible hash of your IP address is kept for up to 15 minutes to limit failed sign-in attempts.",
				],
			},
			{
				h: "Purposes and legal grounds",
				list: [
					"Sharing project files securely with our customers and managing your account — performance of a contract (KVKK Art. 5/2-c).",
					"Logging access, preventing unauthorised access and investigating incidents — legal obligation and legitimate interest (KVKK Art. 5/2-ç and 5/2-f).",
				],
			},
			{
				h: "Where data is stored and transfers",
				p: [
					"The portal runs on Cloudflare, Inc. infrastructure. Account details and activity logs are stored in a Cloudflare database; files are stored in Cloudflare storage or on Prodinox's own file server. Cloudflare servers may be located outside Türkiye, which constitutes a cross-border transfer under Article 9 of KVKK.",
					"Your data is never used for marketing or advertising and is never sold. It may be shared with competent authorities where required by law.",
				],
			},
			{
				h: "Retention",
				p: [
					"Account details are kept while your account exists and deleted when it is removed. Files are kept for the duration of the project and any statutory retention period, then deleted. Activity logs are kept for a reasonable period for security and evidential purposes.",
				],
			},
			{
				h: "How we protect your files",
				list: [
					"Every connection is encrypted with HTTPS (TLS); browsers are prevented from connecting without encryption (HSTS).",
					"Files in Cloudflare storage are encrypted at rest.",
					"Each customer only sees the folders they have been granted; permissions are set per folder (view / upload).",
					"Files are never shared through public links; every download is checked against your session and permissions, and logged.",
					"Repeated failed sign-ins temporarily lock the account; many attempts from the same address are throttled as well.",
					"Sessions expire after 7 days; changing your password signs out your other devices.",
					"Portal pages are never cached by browsers or proxies and cannot be embedded in other sites.",
				],
			},
			{
				h: "Cookies",
				list: [
					"prodinox_session — keeps you signed in (strictly necessary, up to 7 days).",
					"prodinox_lang — remembers your language (1 year).",
					"No tracking, analytics or advertising cookies; nothing, not even fonts, is loaded from third-party servers.",
				],
			},
			{
				h: "Your rights",
				p: [
					"Under Article 11 of KVKK you may ask whether your data is processed, request information about it, learn its purpose and recipients, request correction, deletion or destruction, ask that recipients be notified, object to an adverse outcome of automated analysis, and claim compensation for damages.",
					"Send requests through the contact channels on prodinox.com.tr or via your contact person at Prodinox. Requests are answered within 30 days at the latest.",
				],
			},
			{
				h: "What we ask of you",
				list: [
					"Do not share your password; sign out when you finish on a shared computer.",
					"Only upload files relevant to the project and make sure they are free of malware.",
					"If you notice a security issue, please tell Prodinox right away.",
				],
			},
		],
	},
};
