# Message au support d'API-Football

À envoyer depuis le tableau de bord (dashboard.api-football.com → Support), en anglais.
Remplacer `<clé>` par les 4 premiers caractères de la clé seulement.

---

**Subject:** Ultra plan — requests from Cloudflare Workers rejected as "Too many requests"

Hello,

I run a football statistics app on the Ultra plan (API key starting with `<clé>…`). My
backend is a Cloudflare Worker, so my requests reach you from Cloudflare's shared egress
IP addresses.

Since a few days, even a single isolated request (for example `/status`, with no other
traffic from my key for several minutes) is answered with:

`{"errors":{"rateLimit":"Too many requests. You have exceeded the limit of requests per minute of your subscription."}}`

My own rate limiter keeps me well under 450 requests per minute, and the daily usage shown
in my dashboard is far below the quota. I therefore believe the block is applied at the
IP level, to Cloudflare's shared addresses, rather than to my key.

Could you please:
1. confirm whether my key or the Cloudflare IP ranges are currently blocked, and
2. tell me whether the IP-level protection can be relaxed for my key, or whether you
   recommend calling the API from a dedicated IP address instead?

Thank you for your help,
Ahmed Bensouna
