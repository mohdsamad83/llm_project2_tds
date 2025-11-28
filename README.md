# llm_project2_tds

1) Set env vars in Vercel: AIPIPE_TOKEN, MY_SECRET, MY_EMAIL.
2) Vercel install command: npm ci && npx playwright install --with-deps
3) Vercel build command: npm run build
4) Endpoint: POST /api/quiz with JSON { "email", "secret", "url" }
