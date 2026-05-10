# A chi risponde

## L'idea base

Tu definisci una "regola" che decide, per ogni chat, se il bot deve gestirla o ignorarla. La regola è una funzione semplice scritta in un file di configurazione.

## Esempio tipico

Esempio realistico: vuoi che il bot risponda solo a chi ha numero vietnamita, escludendo due numeri specifici (la zia, il commercialista) e ignorando i contatti salvati in rubrica.

Espresso a parole:

> Risponde se il numero inizia con +84 E non è uno dei due numeri della blacklist.

## Tipi di regole possibili

La regola può combinare condizioni con `E`, `O`, `NON`. Esempi di criteri:

- Numero che inizia con un certo prefisso.
- Numero presente in una whitelist (lista di numeri ammessi).
- Numero presente in una blacklist (lista di numeri da escludere).
- Contatto salvato in rubrica (sì/no).
- Nome contatto contiene una certa parola.
- Combinazioni delle precedenti.

## Modifica della regola

La regola sta in un file dentro la cartella `config/`. Si modifica con un editor di testo qualunque. Non serve riavviare il bot: alla salvataggio del file, il bot ricarica la regola da solo.

Se la modifica contiene un errore, il bot lo segnala nei log e tiene la versione precedente attiva. Niente downtime.

## Cosa succede a chi NON è nella regola

Niente. Il bot vede arrivare il messaggio, controlla, decide "non in lista", lo lascia stare. Tu lo vedrai normalmente sul telefono come sempre.

## Aggiungere una persona alla lista

Modifichi il file di configurazione, salvi. Funziona.

## Rimuovere una persona

Stessa cosa.

## Esempio di regola scritta

Non serve essere programmatori per leggerla, ma per modificarla bisogna conoscere un minimo di sintassi. Esempio:

```
risponde-a:
  numero inizia con +84
  e numero NON in [+84111111111, +84222222222]
```

Tradotto: solo numeri vietnamiti, escluse due eccezioni.

## Limiti

- Il bot non gestisce mai chat di gruppo, indipendentemente dalla regola.
- La regola si applica al numero, non al contenuto del messaggio. Se vuoi un filtro su parole chiave nel messaggio (es. "rispondi solo se chiede aiuto"), questa è una funzionalità non prevista in questa versione.
