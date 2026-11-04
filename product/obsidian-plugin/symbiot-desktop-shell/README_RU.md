# Symbiot Desktop Shell

Статус: `YELLOW / scaffold`.

Назначение: Windows-оболочка продукта открывает основной HARNES GUI Симбиота как desktop-приложение и при необходимости поднимает локальный connector service.

Что уже заложено:

- одно окно продукта `Симбиот`;
- загрузка `http://127.0.0.1:8787/app?shell=desktop`;
- запуск connector service, если `/health` не отвечает;
- отключенный Node.js внутри окна;
- внешние ссылки открываются через системный браузер;
- браузерная `/app` остается fallback и кроссплатформенным GUI;
- мобильная версия остается через QR/local mobile panel.

Что не считается готовым:

- подписанный Windows installer;
- автообновление desktop-shell;
- production remote relay;
- marketplace/public release;
- security audit готового installer.

