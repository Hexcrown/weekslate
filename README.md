# Weekslate

A self-hosted family wall calendar and chore board. Put it on an old iPad, manage it from your phone.

- **Calendar**: shows events from any calendar link (Apple "Public Calendar", Google "secret address in iCal format", or any .ics URL). Weekslate never edits your events.
- **Whose event is it?** Each calendar belongs to a person or to Everyone, and events take that person's color (Everyone gets a neutral color, good for trips). An event whose title names someone, like "Ava dance recital", takes that person's color whatever calendar it is on. You can turn that off in Settings > Display. Tip: one calendar per person works well.
- **Chores**: people, recurring chores (daily, weekly on chosen days, every other week, monthly, once), tap to check off, optional points scoreboard.
- **Settings page**: first-run setup wizard, then manage everything at `/settings.html`.
- **Optional PIN**: guards changes only. The wall display and chore check-off stay open.

## Run it

    docker compose up --build

Open `http://<server-ip>:8000` on the iPad. The setup wizard runs the first time.
On the iPad: Share -> Add to Home Screen, then enable Guided Access to lock it to the app.
Data lives in `./data/weekslate.sqlite`. Back that file up.

(Optional) `CALENDAR_URLS` in `.env` still works as a fallback; links added in Settings take priority.

## Security notes

- Do **not** expose this to the public internet. Reach it from home Wi-Fi, or use Tailscale/WireGuard when away.
- A calendar link contains a secret. Weekslate stores it in its database and only ever shows a masked version.
- The PIN is 4-8 digits, hashed (PBKDF2), rate limited (5 wrong tries, then 60 s lock). It stops kids and guests, not a determined attacker on your network.

## Develop

    cd backend && pip install -r requirements.txt && pytest
    WEEKSLATE_FRONTEND=../frontend uvicorn main:app --reload

## License

MIT. See [LICENSE](LICENSE).

## Support

Weekslate is a free hobby project. If it's useful to your family, you can [buy me a coffee](https://buymeacoffee.com/hexcrown). Thank you!
