# Team Hours — WallCraft Community Widget

**Tek problemi çözer:** "Takımdakilere ne zaman mesafe ederim?" — yani *birlikte çalışabileceğiniz saat aralığı nerede?*

Seçtiğiniz şehirlerin canlı saatini kendi saatinle yan yana gösterir ve
altındaki 24 saatlik şerit, **herkesin mesai saatlerinin kesiştiği aralığı**
parlak bir blokla işaretler. Artık "acaba onlara saat kaçta uygun?" diye
tahmin etmek yok; pencere doğrudan ekranda.

---

## Çözülen problem

Uzaktan çalışan ekiplerde en sık yaşanan ve en çok zaman kaybettiren şey,
bir toplantı veya mesaj göndermek için karşı tarafın saatini hesaplamaktır.
Bu widget hesabı sürekli görünür kılar:

| Satır | Anlamı |
| --- | --- |
| Büyük saat (sağ üst) | Senin yerel saatin, saniye + tarih |
| `London 23:11 (-2sa)` | Şehrin canlı saati, senin saatine göre farkı, güneş/ay ikonu (06:00–20:00 = gündüz) |
| `Cum` / `CMT` etiketi | O şehirdeki gün. Bir gün ileri/geri olduğunda vurgulanır |
| Şerit + parlak blok | Herkesin ortak çalışma penceresi |
| Alt satır | `Şu an uygun`, `Sonraki pencere 16:00–18:00 (14s 48dk)` veya `Bugün için ortak mesai penceresi yok` |

## Kurulum

**Klasörle:**
WallCraft → Ayarlar → *Modules & Widgets* → **Import Folder** → bu klasörü seçin.

**Zip ile:**
Aynı ekrandaki **Import Package** ile `team-hours.zip` dosyasını seçin
(`manifest.json` arşivin kökündedir).

Varsayılan yerleşim 24×24 ızgarada **6×5** hücredir (1080p'de 480×225 px).
Kendi boyutunuzu ayarlardan veya sürükleyerek değiştirebilirsiniz; widget
gerçek boyutuna göre yazı tipi ve şeridi ölçekleyerek her boyutta okunur kalır.

## Ayarlar

| Alan | Açıklama |
| --- | --- |
| `Header Title` | Sol üstteki başlık |
| `City 1 … City 4` | IANA saat dilimi seçimi (46 şehir, `(none)` ile boş bırakılabilir). Kendi şehrini seçersen satır otomatik gizlenir, çünkü zaten başlıkta görünüyor |
| `24-Hour Clock` | 24 saat / 12 saat biçimi (yerelleştirilmiş, TR'de `ÖÖ 03:30`) |
| `Working Hours Start / End` | Herkes için varsayılan mesai aralığı (şerit buna göre çizilir) |
| `Count My Own Hours` | Ortak pencere hesabına senin saatin de dahil edilsin mi |
| `Show Overlap Timeline` | Alt şeridi gizle |

## Teknik notlar

- **İzin gerekmez.** `manifest.json` içinde `permissions` tanımlı değildir; hiçbir
  host API'si çağrılmaz. Zaman dilimi bilgisi tarayıcının `Intl` veri tabanından
  gelir, bu yüzden **yaz saati/geçiş (DST) otomatik doğrudur**.
- **Tema uyumu.** Tüm renkler/yarıçaplar/yazı tipleri `--wc-theme-*`,
  `--theme-*` ve `--wc-font-*` token'larından okunur; 17 wrapper temasının
  tamamıyla uyumlu, her temada çalışan bir geri düşüş zinciri vardır.
- **Sıfır DOM çöplüğü.** Yazma işlemleri değer değişmeden yapılmaz, `Intl`
  nesneleri önbelleğe alınır, şerit yalnızca ayar değişince veya 30 saniyede
  bir yeniden hesaplanır.
- **Sıfır sızıntı.** Tek bir `setInterval` kullanılır; `pause()` ve
  `destroy()` içinde durdurulur, dil aboneliği iptal edilir, önbellek boşaltılır.
  (Runtime zaten `setInterval`/`setTimeout`/`rAF` çağrılarını duraklatır, yine
  de kendi temizliğimizi yapıyoruz.)
- **Erişilebilirlik / ölçek.** `container: tz / size` + `cqh` birimleri sayesinde
  1080p'den 4K'ya kadar aynı görsel dengeyi korur; 150px altındaki boyutlarda
  şerit, hafta günü ve tarih otomatik gizlenir.
- **Dil desteği.** `window.WallCraft.language` + `onLanguageChange` ile TR/EN
  arasında canlı geçiş yapar.

## Dosyalar

```
manifest.json   kimlik, ızgara boyutu, ayar şeması
widget.html     iskelet
widget.css      tema tokenları + konteyner sorguları
widget.js       yaşam döngüsü (init/update/pause/resume/destroy)
icon.png        256×256 katalog ikonu
preview.png     1280×720 katalog önizlemesi
```

## Geliştirici notu

`widget.html` dosyasını doğrudan Chrome'da açtığınızda widget, host olmadığını
fark edip varsayılan ayarlarla kendini mount eder — böylece temaya ve düzene
F12 ile bakabilirsiniz. WallCraft içinde çalışırken bu yol tamamen kapalıdır.
