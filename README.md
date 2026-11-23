# BEP Hazırlama Sistemi – Yayın Rehberi

Bu klasördeki uygulama **hesapsız ve çevrimdışı** çalışır (giriş ekranı yok, internet/CDN gerekmez). Veriler cihazda saklanır.

## Klasör
- `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`, `gizlilik.html` → yayınlanacak web uygulaması (PWA)
- `www/` → aynı dosyaların kopyası (Capacitor için)
- `package.json`, `capacitor.config.json` → Android/iOS paketleme için
- `store/muadil-arastirmasi.md` → mağazadaki benzer uygulamaların araştırması

## 1) En hızlı yol: PWA (mağazasız, ana ekrana yükleme)
1. Dosyaları GitHub deponuza yükleyin (index.html ile aynı klasöre hepsini).
2. Depo → Settings → Pages → Branch: main / root → Kaydet.
3. Telefonda adresi Chrome (Android) veya Safari (iPhone: Paylaş → Ana Ekrana Ekle) ile açın. Uygulama ilk açılıştan sonra internetsiz de çalışır.
> PWA için HTTPS gerekir; GitHub Pages bunu sağlar.

## 2) Google Play
**Seçenek A – PWABuilder (en kolayı):** pwabuilder.com'a Pages adresinizi girin → Android paketini indirin (TWA). Play Console'a yükleyin.
**Seçenek B – Capacitor:** `npm install` → `npx cap add android` → `npx cap sync` → Android Studio'da açıp AAB üretin. Dosya kaydetme için `npm i @capacitor/filesystem @capacitor/share` kurup `npx cap sync` yapın (uygulama bu eklentileri otomatik kullanır).
Gerekenler: Play geliştirici hesabı (tek seferlik ücret), gizlilik politikası URL'si (`gizlilik.html` adresiniz), Data safety formu ("veri toplanmıyor" doğru beyan), hedef kitle yetişkin/öğretmen, içerik derecelendirme anketi.

## 3) Apple App Store
Mac + Xcode ve Apple Developer üyeliği (yıllık ücret) gerekir. `npx cap add ios` → `npx cap sync` → Xcode'da arşivleyip App Store Connect'e yükleyin. App Privacy: "Veri toplanmıyor". Not: Apple, yalnızca web sitesini saran uygulamaları reddedebilir; çevrimdışı çalışma, dosya paylaşma gibi yerel özellikler başvuruyu güçlendirir.

## 4) Microsoft Store
pwabuilder.com → Windows paketi.

## Bilinen sınırlar (dürüst not)
- **Mağaza (Capacitor) sürümünde "Yazdır / PDF" çalışmaz**: Android/iOS WebView `window.print()` desteklemez. Bu sürümde buton açıklama gösterir; Word ve Excel dışa aktarma, `Filesystem + Share` eklentileriyle çalışacak şekilde yazıldı ama **gerçek cihazda test edilmedi**. PDF için PWA/Chrome sürümü sorunsuzdur. Mağaza sürümünde PDF için bir yazdırma eklentisi eklenmelidir.
- `capacitor.config.json` içindeki `appId` (com.example.bephazirlama) kendi paket adınızla değiştirilmeli.
- `gizlilik.html` bir şablondur; [AD SOYAD], [E-POSTA], [TARİH] alanlarını doldurun ve KVKK açısından hukukçuya kontrol ettirin.
- Uygulamanın sürümünü güncellerken `sw.js` içindeki `VERSION` değerini artırın.
- Resmî kazanım listeleri sınırlı kademe/derslerde doğrulanmıştır; uygulama içi "Doğrulanmamış" etiketleri mağaza açıklamasında da belirtilmelidir.
