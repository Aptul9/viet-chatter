# When it replies

The bot does not reply right away. It waits. It is designed that way to avoid looking automated.

## The three timing rules

### 1. Nothing at night

From 22:00 to 06:00 the bot stays silent. If a person writes to you at night, the reply goes out the next morning, at a sensible time (around 06:00 with a small random margin).

### 2. Wait until they finish writing

If the person sends you 4 messages in a row ("hi", "how are you", "I wanted to tell you", "got a minute?"), the bot does not reply after the first one. It waits about 2 minutes of total silence, then considers the "burst" closed and prepares a reply that accounts for all 4.

There is also a safety limit: if the person keeps writing every minute without stopping, after 10 minutes from the first message the bot considers the burst closed anyway (otherwise it would wait forever).

### 3. Mimic your average response time

When the burst is closed, the bot computes how long you usually take to reply to that person, and uses a similar average. Example:

- If you usually take about 30 minutes to reply to Maria, the bot also waits about 30 minutes before sending the reply.
- If you reply quickly to Luigi (5 minutes), the bot is quick with Luigi.
- It adds a bit of randomness (plus or minus 20%) so it is not too predictable.

## The limits

- Minimum 5 minutes from the moment the burst closes.
- Maximum 2 hours.

If the computed average says "1 minute" the bot still uses 5 minutes (anything below would look like a bot). If the average says "8 hours", the bot uses 2 hours (longer would be rude).

## Full timing example

```
14:00  Maria writes "hi"
14:00  bot sees, silence timer starts (2 min)
14:01  Maria writes "how are you?"
14:01  silence timer reset to zero (she wrote again)
14:03  two minutes of silence, bot considers burst closed
       delay calc: avg recent reply to Maria = 30 min
       with randomness +/-20%: say 33 min
       reply scheduled for 14:36
...
14:36  bot sends the reply
```

## What happens if you reply in the middle

If, while the bot is waiting (or about to fire), you reply manually, it notices and cancels. It does not send anything.

The only exception is if you reply in the exact millisecond when the bot is about to send. In that case both can go out. Rare, not destructive.

## What happens if you have 5 chats pending when you come back online

The bot does not fire 5 replies in 5 seconds. It spreads them over time (with random delays between one and the next) so it does not look like a robot just restarted.

## Exceptions to "no night"

None. Even if the person writes a dramatic message at 02:00, the bot still replies in the morning. If you want to reply right away, you do it by hand from the phone.
