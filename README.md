# Investeringsvergelijking Dashboard

Vergelijk huurappartement vs ETF over een instelbare horizon (nominaal/reëel).

## Lokaal draaien

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

## Online (GitHub Pages)

1. Maak op GitHub een **public** repository `investment-comparison` (leeg, geen README).
2. In deze map:

```bash
git remote add origin git@github.com:JOUW-GEBRUIKER/investment-comparison.git
git push -u origin main
```

3. Op GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Na de eerste workflow-run: **https://JOUW-GEBRUIKER.github.io/investment-comparison/**

Scenario’s en aantekeningen blijven in **localStorage** per browser (niet op GitHub).
