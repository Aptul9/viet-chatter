# Cosa fa il bot

Risponde alle chat WhatsApp al posto tuo. Solo certe chat, scelte da te. Lo fa girando sul tuo computer e usando il tuo numero (esattamente come quando sei tu davanti al telefono).

## Esempio concreto

Hai 30 chat aperte, ma vuoi che il bot risponda solo alle persone con prefisso vietnamita, escluse 2-3 specifiche. Tutte le altre chat (parenti, lavoro, gruppi) restano intoccate. Tu le vedi e rispondi a mano come al solito.

Quando una persona "in lista" ti scrive:

1. Il bot legge il messaggio.
2. Aspetta un po' (per non sembrare un bot che risponde all'istante).
3. Costruisce una risposta sensata, basata su quello che sa di lei.
4. Manda la risposta come se fossi tu.

## Cosa lo rende diverso da un risponditore automatico

- **Sembra umano**: aspetta minuti o ore, non secondi. Imita il tuo tempo medio di risposta a quella persona.
- **Non risponde di notte**: dalle 22:00 alle 06:00 sta zitto. Le risposte arrivano la mattina.
- **Si adatta**: tono, lingua e contenuto cambiano in base alla persona.
- **Si ricorda**: la prossima volta che quella persona ti scrive, il bot si ricorda cosa avevi detto la settimana scorsa.
- **Sa quando non sa**: quando la persona chiede una cosa che il bot non può sapere o decidere al posto tuo (un appuntamento futuro, un favore importante, un argomento delicato), invece di inventare ti notifica fuori da WhatsApp e tu vai a rispondere a mano. Vedi `12-quando-ti-chiama.md`.

## Cosa non sa fare

- Non legge sticker, immagini, audio, video. Vede solo che sono arrivati e decide se ignorarli o rispondere brevemente.
- Non chiama, non videochiamate.
- Non manda file o foto.
- Non gestisce gruppi.

## Quando il bot capisce che ti rifai vivo tu

Se mentre il bot stava per rispondere, rispondi tu da telefono o PC, il bot se ne accorge e cancella la sua risposta. Non manda doppio.

In rari casi (millisecondi di sovrapposizione) potrebbero partire entrambi. Niente di grave, ma è possibile in teoria.
