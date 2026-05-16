# Quando il bot ti chiama

In alcune situazioni, il bot si rende conto da solo che non può rispondere al posto tuo. In questi casi non inventa, e ti avvisa fuori da WhatsApp che c'è una cosa da gestire a mano.

## Quando succede

L'AI ti chiama (cioè manda una notifica) quando il messaggio in arrivo richiede informazioni o decisioni che non può conoscere. Esempi tipici:

- **Appuntamenti**: "Ci vediamo sabato alle 19?". Il bot non sa se sei libero sabato. Non vuole dirti di sì sbagliando, e nemmeno dire di no quando in realtà sei libero. Ti avvisa.
- **Impegni**: "Mi presti 50 euro?", "Posso passare da te stasera?". Decisione che riguarda te, non il bot.
- **Argomenti delicati**: la persona ti scrive di un lutto recente, di una rottura, di una notizia pesante. Il bot non vuole rischiare di rispondere male. Ti avvisa così rispondi tu di persona.
- **Soldi e cose serie**: richieste finanziarie, accordi vincolanti.
- **Opinioni personali forti**: politica, fede, scelte di vita su cui il bot non ha tracciate le tue posizioni.

## Cosa succede di concreto

1. La persona ti scrive una cosa "delicata" (esempio: "Sei libero domenica?").
2. Il bot prova a generare la risposta. L'AI capisce che non lo sa.
3. Il bot fa due cose:
   - **Manda un messaggio "ponte"** alla persona, tipo "Aspetta che controllo, ti faccio sapere". Serve a non lasciarla nel silenzio.
   - **Ti notifica** sul canale che hai configurato (Telegram o WhatsApp con te stesso).
4. Tu vedi la notifica. Apri WhatsApp, leggi la chat, rispondi a mano come faresti normalmente.
5. Il bot vede che hai risposto e segna la cosa come risolta.

## Esempio concreto

**Su WhatsApp (Hoa ti scrive)**:

```
Hoa: Sei libero sabato sera per cena?
[bot dopo un po', invia da solo]
Tu: Aspetta che controllo, ti faccio sapere
```

**Su Telegram (notifica al volo)**:

```
[viet-chatter] SCHEDULING
Da: Hoa (+8412345)
Riassunto: Hoa ti chiede se sei libero sabato sera per cena. Non ho informazioni sui tuoi impegni.
Holding reply inviata: "Aspetta che controllo, ti faccio sapere"

Vai a rispondere su WhatsApp.
```

Tu apri Telegram, vedi il messaggio, capisci, vai su WhatsApp e rispondi a mano "Sì alle 20 va bene".

## Canali disponibili

Puoi scegliere uno o entrambi:

### Telegram

Setup una tantum: crei un Telegram bot personale (gratis, via @BotFather), copi il token, lo metti nel file `.env` del bot. Ti scrivi col tuo bot Telegram per recuperare il tuo `chat_id` e lo metti nello stesso `.env`.

Pro: notifiche affidabili, separate da WhatsApp. Se WhatsApp Web smette di funzionare, Telegram continua.

Contro: 5 minuti di setup iniziale.

### WhatsApp self-chat (chat con te stesso)

Il bot ti scrive sulla tua chat personale ("Te stesso"/"You" in WhatsApp). Zero setup.

Pro: niente da configurare.

Contro: Le notifiche WhatsApp della chat con te stesso possono non essere visibili come notifica push su tutti i telefoni e versioni di WhatsApp. Prima del primo uso, mandati un messaggio dal computer e verifica che il telefono ti faccia vedere la notifica come fai con le altre chat. Se non la vedi, conviene usare Telegram.

### Entrambi

Se vuoi sicurezza, configura entrambi. Il bot manda su tutti e due i canali in parallelo. Una notifica arriva.

## Quanta urgenza

L'AI sceglie il livello di urgenza (`low`, `normal`, `high`) e te lo indica nella notifica:

- **Normal** (default): notifica al volo, lo gestisci nel giro dei prossimi minuti/ore.
- **High**: cose tipo "vengo da te tra 10 min, mi apri?". Il bot ti avvisa subito senza nessun delay.
- **Low**: cose meno urgenti. In v1 funziona come Normal. In futuro confluiranno in un riepilogo giornaliero.

## Non vai a rispondere

Se ignori la notifica e non rispondi mai a Hoa, il bot non insisterà. Hoa ha visto il "ti faccio sapere" e probabilmente ti scriverà di nuovo. A quel punto il bot vedrà il nuovo messaggio e se ancora non sa, ti rinotifica (ma evita di duplicare se la richiesta è la stessa).

## Posso disabilitarlo

Sì. Nel file di configurazione `config/index.ts`:

```ts
escalation: {
  enabled: false,
  ...
}
```

Salvi, hot-reload, dal turn successivo il bot riprende a generare risposte autonome anche sui casi delicati. Sconsigliato: il bot inventerà appuntamenti che non hai. Meglio tenerlo on.

## Posso configurare per chat specifica

In v1 no. Il filtro è globale: l'AI decide turn per turn se escalare.

In futuro è prevista la possibilità di forzare "sempre escalation" o "mai escalation" per persona specifica. Vedi `dev/16-future-enhancements.md`.

## Cosa NON fa il bot

- Non ti chiama davvero al telefono. "Chiamare" qui è un modo di dire: ti notifica.
- Non manda email.
- Non scrive sul tuo calendar.
- Non posta su Slack o Teams o altro.

Solo Telegram e/o self-chat WhatsApp. Per niente di più sofisticato in v1.

## Privacy

Il messaggio di notifica include:

- Nome o numero della persona che ti ha scritto.
- Una riga di riassunto del perché stanno chiedendo (generata dall'AI).
- Il messaggio "ponte" inviato (se inviato).

Non include il body completo del messaggio originale. Ma il riassunto è di per sé sensibile: se Hoa ti ha scritto di un lutto, il riassunto lo dice.

Telegram e WhatsApp self-chat sono entrambi su provider esterni (Telegram = server di Telegram; WhatsApp self-chat = server di WhatsApp). Tienilo presente. Se vuoi privacy massima sul canale di notifica, esiste un'opzione self-host con `ntfy.sh` o `Gotify`, ma non è in v1.

## Quando NON ti chiama

L'AI è istruita a essere conservativa nel chiamarti, per non spammarti:

- Convenevoli ("come stai?", "ciao!"): risponde da sola.
- Domande informative coperte dal diario ("dove vivi?", "che lavoro fai?"): risponde da sola.
- Continuazioni di thread dove tu hai già chiarito la posizione nei messaggi precedenti: risponde da sola.
- Sticker, emoji singoli, audio, immagini: stesso comportamento di prima (silenzio o risposta breve, vedi `08-quando-non-risponde.md`).

## Limite di volume

Per non spammarti, c'è un cap di 12 notifiche all'ora di default (configurabile). Oltre il cap, le ulteriori escalations vengono aggregate in un'unica notifica "X cose da gestire, controlla". Le `high` urgency saltano il cap.

## Riassunto dei comportamenti

- Bot ricevuto messaggio "delicato" -> manda holding reply -> ti notifica.
- Tu vedi notifica -> apri WhatsApp -> rispondi -> bot segna come risolto.
- Tu non vedi notifica -> persona riscriverà più tardi -> bot rinotifica se ancora delicato.
- Bot offline al momento del messaggio -> al ritorno online, processa normalmente, escalation parte allora.
