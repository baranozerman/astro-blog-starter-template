# Composio → Claude Connector

Bu site, Composio'daki uygulama araçlarını (Gmail, Google Sheets, Slack, …) Claude'a tek bir
**özel connector** olarak sunan bir MCP sunucusu içerir: `https://<site>/mcp/<MCP_SECRET>`.

Claude bir aracı çağırdığında istek bu worker'a gelir. Worker da aracı Composio API'si üzerinden,
Composio'da bağladığınız hesapla çalıştırır. Composio API anahtarı yalnızca sunucuda tutulur.

## Kurulum

1. **Composio hesabı**: <https://platform.composio.dev> → *Settings → API Keys* bölümünden bir API anahtarı alın.
2. **Uygulamaları bağlayın**: Composio panelinde kullanmak istediğiniz uygulamaları (örn. Gmail) bağlayın.
   Bağlantıyı hangi *user id* ile yaptıysanız (varsayılan `default`) aşağıda `COMPOSIO_USER_ID` olarak onu kullanın.
3. **Secret'ları girin**:

   ```sh
   npx wrangler secret put COMPOSIO_API_KEY
   npx wrangler secret put MCP_SECRET          # uzun, rastgele bir değer (örn. openssl rand -hex 32)
   npx wrangler secret put COMPOSIO_TOOLKITS   # örn. gmail,googlesheets
   npx wrangler secret put COMPOSIO_USER_ID    # isteğe bağlı, varsayılan: default
   npx wrangler secret put COMPOSIO_TOOLS      # isteğe bağlı: yalnızca bu araçlar, örn. GMAIL_SEND_EMAIL,GMAIL_FETCH_EMAILS
   npm run deploy
   ```

4. **Claude'a ekleyin**: claude.ai → *Settings → Connectors → Add custom connector*
   - Name: `Composio`
   - URL: `https://<site>/mcp/<MCP_SECRET>`

   Ardından bir sohbette connector'ı açın. Claude, Composio araçlarını (örn. `GMAIL_SEND_EMAIL`) görecektir.

## Ayarlar

| Değişken | Açıklama |
| --- | --- |
| `COMPOSIO_API_KEY` | Composio API anahtarı (zorunlu) |
| `MCP_SECRET` | Connector URL'sindeki gizli değer (zorunlu). Bu değer olmadan `/mcp` uç noktası 404 döner |
| `COMPOSIO_TOOLKITS` | Sunulacak toolkit'ler, virgülle ayrılmış (örn. `gmail,slack`) |
| `COMPOSIO_TOOLS` | İsteğe bağlı. Doluysa yalnızca bu araç slug'ları sunulur (`COMPOSIO_TOOLKITS` dikkate alınmaz) |
| `COMPOSIO_USER_ID` | Araçların hangi Composio kullanıcısının bağlı hesaplarıyla çalışacağı (varsayılan `default`) |

Araç listesi her worker örneğinde 5 dakika önbelleğe alınır. Ayarları değiştirdikten sonra yeniden deploy edin.

## Güvenlik

- Connector URL'si bir şifre gibidir: URL'yi bilen herkes bağlı hesaplarınız adına işlem yapabilir.
  Paylaşmayın. URL sızarsa `MCP_SECRET` değerini değiştirip connector'ı yeni URL ile yeniden ekleyin.
- Riski azaltmak için `COMPOSIO_TOOLS` ile yalnızca gerçekten gereken araçları açın (örn. sadece okuma araçları).

## Dosyalar

- `src/lib/composio.ts`: Composio REST API (v3.1) istemcisi
- `src/pages/mcp/[token].ts`: MCP uç noktası (Streamable HTTP, durumsuz)
