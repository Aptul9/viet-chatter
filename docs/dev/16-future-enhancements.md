# Future enhancements

Lista finita. Tutto fuori da questa lista è automaticamente out-of-scope.

| # | Enhancement | Trigger di valutazione |
|---|---|---|
| 1 | **Sentiment con modello locale**. `@xenova/transformers` con `cardiffnlp/xlm-roberta-base-sentiment` o equivalente. Label persistito su `processed_messages` (o tabella dedicata) per analytics longitudinale del rapporto. | Quando l'inline sentiment-aware del prompt corrente si rivela insufficiente o si vuole tracking nel tempo (sentiment medio per chat, drift, ecc.). |
| 2 | **Dynamic delay livello 3** (modifiers contestuali): time-of-day modifier (lunch slow, morning fast), sentiment-aware delay (urgent / negative -> faster), recency boost (chat attiva nei minuti precedenti -> delay corto). | Quando jitter ±20% su rolling avg sembra troppo "uniforme" e tradisce il pattern. Indicatore: persone che notano "rispondi sempre dopo 15 minuti precisi". |
| 3 | **Dynamic delay livello 4** (model-driven): l'AI suggerisce `delay_hint_ms` nel TurnOutput, state machine applica come override entro `[minDelayMs, maxDelayMs]`. | Solo dopo aver provato livello 3 e averne misurato i limiti. Rischio: delay erratici se l'AI sbaglia. Richiede telemetria solida. |
| 4 | **Multi-backend AI**: ri-abilitare rotation con Groq/Gemini API, Claude/Codex CLI, e backend UI via Playwright (Qwen/DeepSeek/ChatGPT/Kimi). Tutto come copiato 1:1 da `linkedin-autoapply`. | Quando OpenCode si rivela instabile o si vuole costo zero per alcuni workload (free tier vari, modelli locali via UI). Richiede ri-validazione del prompt su ogni backend. |
| 5 | **Postgres + pgvector migration**. Vedi `14-portabilita-postgres.md`. | Solo se: oltre 1M vettori (improbabile single-user), accesso multi-machine, concorrenza alta. |
| 6 | **Engagement state lifecycle** più granulare. Stati aggiuntivi a `cold`: `dormant`, `breakup`, `do_not_re_engage`. Comportamenti differenziati per re_engage e revive. | Quando il binario `active`/`cold` non basta e si nota che persone diverse richiedono trattamenti diversi (es. ex partner -> mai re-engage; conoscenze sporadiche -> threshold lungo). |
| 7 | **Dashboard locale con Next.js**. Piccola UI read-only che legge da `turn_log`, `facts`, `manual_jobs`, `chat_state`. Niente Express. | Quando il check da log file e `npm run health` diventa scomodo. Use case: capire al volo perchè il bot non ha risposto a X. |
| 8 | **Daily digest in self-chat**. Ogni mattina (es. 08:30 ora locale) il bot manda alla tua chat WhatsApp con te stesso un riassunto: ultime 24h di attivita, job in coda per oggi, KB facts ad alta confidenza appena inseriti per review veloce. | Quando vuoi visibilità sul lavoro del bot senza guardare log o dashboard. Costo: una chiamata AI extra al giorno. |

## Cosa NON entrerà mai (esclusioni dure)

Vedi anche `17-out-of-scope.md`. In sintesi:

- Multi-account WhatsApp.
- Group chat.
- Approval flow / draft preview.
- CLI per KB / job management.
- Self-chat command channel strutturato (con prefissi).
- Backup automatico DB.
- Sync multi-machine.
- Cifratura at-rest applicativa.
- Detection avanzata sticker/audio/video.

## Ordine di priorità ipotetico

Non vincolante, è un suggerimento se si decide di lavorare su enhancement futuri:

1. (#8) Daily digest: utile da subito una volta che il bot è in produzione.
2. (#7) Dashboard Next.js: complementare al digest, fornisce vista on-demand.
3. (#1) Sentiment locale: utile per analytics. Costa poco implementare.
4. (#6) Engagement state lifecycle: emerge come bisogno dopo qualche settimana di uso.
5. (#2) Dynamic delay livello 3: solo se si nota che il bot è troppo "regolare".
6. (#4) Multi-backend AI: solo se OpenCode dà problemi.
7. (#3) Dynamic delay livello 4: dopo livello 3.
8. (#5) Postgres: ultima risorsa.

## Criterio per aggiungere alla lista

Un nuovo enhancement entra nella lista solo se:

- È stato discusso e approvato.
- È documentato qui (sostituendo o estendendo).
- Ha un trigger di valutazione esplicito (non "potrebbe essere utile").
- Non sovrappone con out-of-scope.

Senza queste condizioni, resta out-of-scope.
