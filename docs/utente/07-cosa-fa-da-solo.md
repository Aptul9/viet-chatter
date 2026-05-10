# Cosa fa da solo

Oltre a rispondere ai messaggi che riceve, il bot ogni tanto fa partire una conversazione lui per primo. Tre casi.

## 1. Auguri di compleanno (e date importanti)

Se durante una conversazione una persona ti dice "il mio compleanno è il 22 febbraio", l'AI registra questo fatto come importante. Il 22 febbraio dell'anno corrente (e di quelli successivi), il bot manda automaticamente un messaggio di auguri.

Vincoli:

- Se hai già scambiato messaggi con quella persona nelle ultime 12 ore, il bot NON manda gli auguri come messaggio separato. Lascia che l'AI, durante una risposta normale, includa naturalmente gli auguri (vede nella memoria che è il compleanno).
- L'idea è non spammare con un "tanti auguri" se la conversazione vera già copre il tema.

Funziona anche per altre date (anniversari, partenze, esami) se il bot le ha registrate come ricorrenti o specifiche.

## 2. Ravvivamento conversazione (revive)

Quando una conversazione "muore" male: avete chiacchierato a lungo, tu hai detto qualcosa, lei ha risposto solo con un cuore o un emoji corto, e poi silenzio.

Il bot, vedendo che la giornata era ricca di scambi e che il finale è stato secco, può decidere di mandare un piccolo follow-up dopo un po' (es. 30-60 minuti). Un solo tentativo. Se neanche questo riceve risposta, lascia stare.

Niente insistenza, niente messaggi multipli. Un tentativo gentile, poi pausa.

L'AI è istruita a essere conservativa: se la conversazione era già al "tramonto naturale" (saluti formali, "ci sentiamo"), non interviene. Solo se c'è stato un troncamento brusco dopo scambi reali.

## 3. Re-engage dopo silenzio prolungato

Se non parli con una persona da circa 2 settimane, il bot prova a riallacciare i fili. Manda un messaggio naturale tenendo conto di cosa sa di lei dal diario.

Esempio:

- Lei aveva detto che andava in vacanza a Da Nang.
- Sono passate 2 settimane.
- Il bot manda: "Hey, com'è stata Da Nang?"

Vincoli:

- Una sola tentativo per chat alla volta.
- Se dopo il re-engage lei non risponde entro 7 giorni, il bot la marca come "fredda" e non riprova più. Aspetta che sia lei a scriverti.
- Niente re-engage di notte.

Soglia di silenzio default: 14 giorni. L'AI può adattarla in base al tipo di rapporto (con persone che senti spesso, soglia più corta; con conoscenze sporadiche, più lunga).

## Cosa succede se rispondi tu prima del fire programmato

Per tutti e tre i tipi (auguri, revive, re-engage): se prima del momento programmato la persona ti scrive (o tu scrivi a lei), il job auto-programmato si annulla. Niente messaggio doppio.

## Posso disattivare uno di questi comportamenti per una persona specifica?

In v1 non c'è un interruttore comodo. Si può intervenire sulla configurazione globale per disattivarli tutti, oppure scrivere il messaggio a mano e il job si auto-cancella.

In versioni future è prevista una gestione più granulare (vedi `dev/16-future-enhancements.md`).
