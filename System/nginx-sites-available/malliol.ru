# DevSpace (JAPERDAIS) — основной адрес: japerdais.malliol.ru
# malliol.ru и www редиректятся на поддомен; голый IP 144.31.63.224 отдаётся напрямую по HTTP.
# /api/ проксируется на локальный devspace-api (127.0.0.1:3017).
# /soroka/ — мини-приложение бота SorokaBjastovna (127.0.0.1:3018).
# p2phub живёт отдельно на osgo.malliol.ru (sites-available/p2phub) — не пересекаются.

# HTTPS: основной домен DevSpace
server {
    listen 443 ssl;
    server_name japerdais.malliol.ru;
    root /var/www/malliol.ru/html;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/malliol.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/malliol.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://127.0.0.1:3017;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        client_max_body_size 40m;
    }
    location /soroka/ {
        proxy_pass http://127.0.0.1:3018/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location /data/ {
        expires 5m;
        add_header Cache-Control "public";
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# HTTPS: корневой домен уводим на поддомен
server {
    listen 443 ssl;
    server_name malliol.ru www.malliol.ru;

    ssl_certificate /etc/letsencrypt/live/malliol.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/malliol.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    return 301 https://japerdais.malliol.ru$request_uri;
}

# HTTP: все домены уводим на https-поддомен, голый IP отдаём напрямую
server {
    listen 80 default_server;
    listen 8088;
    server_name japerdais.malliol.ru malliol.ru www.malliol.ru _;
    root /var/www/malliol.ru/html;
    index index.html;

    if ($host = japerdais.malliol.ru) { return 301 https://$host$request_uri; }
    if ($host = malliol.ru) { return 301 https://japerdais.malliol.ru$request_uri; }
    if ($host = www.malliol.ru) { return 301 https://japerdais.malliol.ru$request_uri; }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://127.0.0.1:3017;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        client_max_body_size 40m;
    }
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location /data/ {
        expires 5m;
        add_header Cache-Control "public";
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# https по голому IP (без SNI): не показываем сертификат, отклоняем хендшейк
server {
    listen 443 ssl default_server;
    ssl_reject_handshake on;
}
