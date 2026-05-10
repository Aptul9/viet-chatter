# Quando risponde

Il bot non risponde subito. Aspetta. È fatto apposta per non sembrare automatico.

## Le tre regole sui tempi

### 1. Niente di notte

Dalle 22:00 alle 06:00 il bot sta zitto. Se una persona ti scrive di notte, la risposta parte la mattina dopo, in un orario sensato (intorno alle 06:00 con piccolo margine casuale).

### 2. Aspetta che finisca di scrivere

Se la persona ti manda 4 messaggi in fila ("ciao", "come stai", "ti volevo dire", "hai un attimo?"), il bot non risponde dopo il primo. Aspetta circa 2 minuti di silenzio totale, poi considera la "raffica" chiusa e prepara una risposta che tiene conto di tutti e 4.

C'è anche un limite di sicurezza: se la persona continua a scrivere ogni minuto senza fermarsi, dopo 10 minuti dal primo messaggio il bot considera comunque la raffica chiusa (altrimenti aspetterebbe per sempre).

### 3. Imita il tuo tempo medio di risposta

Quando la raffica è chiusa, il bot calcola quanto tempo ci metti tu di solito a rispondere a quella persona, e usa una media simile. Esempio:

- Se di solito ci metti circa 30 minuti a rispondere a Maria, anche il bot aspetta circa 30 minuti prima di mandare la risposta.
- Se rispondi in fretta a Luigi (5 minuti), il bot è veloce con Luigi.
- Aggiunge un po' di casualità (più o meno 20%) per non essere troppo prevedibile.

## I limiti

- Minimo 5 minuti dal momento in cui la raffica si chiude.
- Massimo 2 ore.

Se la media calcolata dice "1 minuto" il bot usa comunque 5 minuti (sotto sembrerebbe un bot). Se la media dice "8 ore", il bot usa 2 ore (oltre sarebbe scortese).

## Esempio temporale completo

```
14:00  Maria ti scrive "ciao"
14:00  bot vede, parte il timer di silenzio (2 min)
14:01  Maria scrive "come stai?"
14:01  timer di silenzio rimesso a zero (lei ha scritto ancora)
14:03  due minuti di silenzio, bot considera raffica chiusa
       calcolo del delay: media risposte recenti a Maria = 30 min
       con casualita +/-20%: per esempio 33 min
       risposta programmata per le 14:36
...
14:36  bot manda la risposta
```

## Cosa succede se rispondi tu in mezzo

Se mentre il bot sta aspettando (o sta per partire), rispondi tu manualmente, lui se ne accorge e annulla. Non manda nulla.

L'unica eccezione è se rispondi proprio nel millisecondo esatto in cui il bot sta per inviare. In quel caso possono partire entrambi. Raro, non distruttivo.

## Cosa succede se hai 5 chat in attesa quando torni online

Il bot non spara 5 risposte in 5 secondi. Le distribuisce nel tempo (con ritardi casuali tra una e l'altra) per non far sembrare che è ripartito un robot.

## Eccezioni al "no notte"

Nessuna. Anche se la persona scrive un messaggio drammatico alle 02:00, il bot risponde comunque la mattina. Se tu vuoi rispondere subito, lo fai a mano da telefono.
