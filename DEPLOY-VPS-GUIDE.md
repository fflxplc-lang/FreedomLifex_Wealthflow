# Wealthflow on your VPS: complete guide

Your setup: a VPS that already runs another project on a subdomain. Wealthflow gets its **own new
subdomain** on the same VPS, called **wealthflow.yourdomain.in** below. The other project and its
settings aren't touched.

Replace these placeholders everywhere you see them:
- `YOUR_VPS_IP`: your server's IP address
- `wealthflow.yourdomain.in`: the new subdomain you want for Wealthflow (any name works, e.g. `crm.` or `mf.`)
- `root`: your VPS login name, if it's different

It takes about 30–45 minutes. Do the parts in order. Each part ends with a check, so you know it worked
before you go on.

---

## Part 0: Create the new subdomain (DNS)

1. Log in where you manage your domain (GoDaddy, Hostinger, Cloudflare, etc.) and open **DNS settings**.
2. Find the record of your existing subdomain and note its **IP address**: that's `YOUR_VPS_IP`.
3. Click **Add record**:
   - Type: **A**
   - Name / Host: **wealthflow**
   - Value / Points to: **YOUR_VPS_IP**
   - TTL: default
4. Save.

✅ **Check** (after 5–30 minutes): in PowerShell on your PC, run `nslookup wealthflow.yourdomain.in`.
It should show YOUR_VPS_IP. You can do Parts 1 to 7 while you wait.

---

## Part 1: Get the files ready on your PC

1. Download **wealthflow-source.zip** from the project.
2. Put it in a folder you can find easily, for example `C:\deploy\`.
3. **Optional: to keep the data you already entered on your PC,** stop the app on your PC (Ctrl+C in
   VS Code), then copy
   `C:\Users\gurud\Downloads\wealthflow-source\wealthflow\server\data\wealthflow.db`
   into `C:\deploy\`. Skip this to start with an empty system.

---

## Part 2: Log in to the VPS

1. On Windows, press Start, type **PowerShell** and open it.
2. Run:
   ```
   ssh root@YOUR_VPS_IP
   ```
   Type `yes` if it asks about a fingerprint, then enter your VPS password. Nothing shows on screen while
   you type the password; that's normal.
3. ✅ **Check:** the prompt changes to something like `root@server:~#`.

Keep this window open. It's the **server window**.

---

## Part 3: Look at what's already there (changes nothing)

Run these one by one and note the answers:
```
node -v
pm2 list
ls /etc/nginx/sites-enabled/
ss -ltnp | grep 5050
```
- `node -v` shows the Node version, for example `v22.11.0` or `v18.19.0`.
- `pm2 list` shows your other project, if it runs with PM2.
- `ls /etc/nginx/sites-enabled/` lists the existing websites. You won't change them; this just confirms
  Nginx is installed. (If it says "No such file or directory", run `apt install -y nginx`.)
- `ss -ltnp | grep 5050` should print **nothing**, which means port 5050 is free. If it prints a line, use
  5060 instead of 5050 everywhere below.

If `pm2: command not found` appears, install it: `npm install -g pm2`.

---

## Part 4: Make sure Node 22 is available

Look at the `node -v` answer from Part 3.

**A) It's v22.5 or higher (v22.x or v23+):** nothing to do. Go to Part 5.

**B) It's older (v20, v18, v16…) or "command not found":** don't upgrade the server's Node, because your
other project may need it. Install Node 22 just for Wealthflow:
```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v
```
✅ **Check:** the last command shows `v22.something`.

> If you used option B, run `nvm use 22` again any time you open a new server window to work on
> Wealthflow. Your other project is not affected.

---

## Part 5: Upload Wealthflow

Open a **second** PowerShell window on your PC (this is the **PC window**) and run:
```
cd C:\deploy
scp wealthflow-source.zip root@YOUR_VPS_IP:/opt/
```
If you copied your database in Part 1, also run:
```
scp wealthflow.db root@YOUR_VPS_IP:/opt/
```

Back in the **server window**:
```
apt install -y unzip
cd /opt
unzip wealthflow-source.zip
cd /opt/wealthflow
ls
```
✅ **Check:** `ls` shows `client  server  package.json  DEPLOY.md …`

> If `/opt/wealthflow` already exists from an earlier try, rename it first:
> `mv /opt/wealthflow /opt/wealthflow-old`

---

## Part 6: Settings

```
cd /opt/wealthflow/server
cp .env.example .env
openssl rand -hex 32
```
The last command prints a long random string. **Copy it.** Now open the settings file:
```
nano .env
```
Change it to look like this (use your own values):
```
PORT=5050
JWT_SECRET=paste-the-long-random-string-here
ADMIN_EMAIL=your-admin-email@yourdomain.in
ADMIN_PASSWORD=Choose-A-Strong-Password1
DATA_DIR=./data
BASE_PATH=
```
Leave `BASE_PATH` **empty**, because Wealthflow has its own subdomain.
Save and close: **Ctrl+O**, **Enter**, **Ctrl+X**.

If you uploaded your old database in Part 5, put it in place now:
```
mkdir -p /opt/wealthflow/server/data
mv /opt/wealthflow.db /opt/wealthflow/server/data/wealthflow.db
```
(With an old database, you keep logging in with your old admin login. ADMIN_EMAIL and ADMIN_PASSWORD
are only used when the database is new.)

---

## Part 7: Install, build and start

```
cd /opt/wealthflow
npm run install:all
npm run build
```
This takes a few minutes. Warnings are fine; look out for lines with `ERR!`.
✅ **Check:** the build ends with `✓ built in …`.

Start it:
```
cd /opt/wealthflow/server
pm2 start src/index.js --name wealthflow
```
**If you used option B in Part 4**, use this instead:
```
pm2 start src/index.js --name wealthflow --interpreter $(nvm which 22)
```
Make it start again after a reboot:
```
pm2 save
pm2 startup
```
(If `pm2 startup` prints a command starting with `sudo env …`, copy that command and run it.)

✅ **Check:**
```
curl http://127.0.0.1:5050/api/health
```
It must print `{"ok":true}`. If it doesn't, run `pm2 logs wealthflow --lines 30` and send me a screenshot.

---

## Part 8: Connect it to the new subdomain (Nginx + HTTPS)

You create a **new** Nginx file just for Wealthflow, so your other project's file isn't touched.
Change the subdomain name in the `server_name` line, then paste the whole block into the server window
in one go:
```
cat > /etc/nginx/sites-available/wealthflow <<'EOF'
server {
    listen 80;
    server_name wealthflow.yourdomain.in;
    client_max_body_size 50M;
    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -s /etc/nginx/sites-available/wealthflow /etc/nginx/sites-enabled/wealthflow
nginx -t
```
✅ **Check:** the last command says `syntax is ok` and `test is successful`. Only then run:
```
systemctl reload nginx
```
**If the test fails,** don't reload. Remove the new file and send me a screenshot:
```
rm /etc/nginx/sites-enabled/wealthflow
```
Your other project keeps running the whole time.

**Turn on HTTPS** (free certificate). Do this only after the Part 0 check shows your VPS IP:
```
certbot --version || apt install -y certbot python3-certbot-nginx
certbot --nginx -d wealthflow.yourdomain.in
```
Enter your email if asked, type `Y` to accept the terms, and choose **redirect** if it asks.
✅ **Check:** it ends with "Congratulations" or "Successfully deployed certificate".

If your VPS has a firewall (`ufw status` shows "active"), make sure the web ports are open:
`ufw allow 'Nginx Full'`.

---

## Part 9: Open it

1. In your browser, go to **https://wealthflow.yourdomain.in**.
2. Log in with ADMIN_EMAIL / ADMIN_PASSWORD from Part 6 (or your old login if you moved your database).
3. Also open your other project's address and check it still works.
4. In Wealthflow, go to Admin Console and confirm your firm details. Then add your team under Clients &
   Map → Hierarchy (or check them, if you moved your database).

🎉 Done.

---

## Part 10: Daily backup (do this once)

```
mkdir -p /opt/backups
(crontab -l 2>/dev/null; echo "0 2 * * * cp /opt/wealthflow/server/data/wealthflow.db /opt/backups/wealthflow-\$(date +\%F).db") | crontab -
crontab -l
```
✅ **Check:** the last command shows the line with `wealthflow.db`. A copy is saved in `/opt/backups`
every night at 2 AM.

Every few weeks, also keep a copy on your PC (from the **PC window**):
```
scp root@YOUR_VPS_IP:/opt/wealthflow/server/data/wealthflow.db C:\deploy\wealthflow-backup.db
```

---

## Installing an update later

When I send a new **wealthflow-all-updates.zip**:

PC window:
```
cd C:\deploy
scp wealthflow-all-updates.zip root@YOUR_VPS_IP:/opt/
```
Server window:
```
cp /opt/wealthflow/server/data/wealthflow.db /opt/backups/before-update-$(date +%F).db
cd /opt/wealthflow
unzip -o /opt/wealthflow-all-updates.zip
npm run install:all
npm run build
pm2 restart wealthflow
```
(Option B from Part 4: run `nvm use 22` first.)
Your settings (`server/.env`) and data (`server/data`) are not replaced by the update.

---

## Useful commands

| What | Command |
|---|---|
| Is it running? | `pm2 status` |
| Show recent errors | `pm2 logs wealthflow --lines 50` |
| Restart | `pm2 restart wealthflow` |
| Stop | `pm2 stop wealthflow` |
| Test the app directly | `curl http://127.0.0.1:5050/api/health` |
| Test the Nginx file | `nginx -t` |

## If something goes wrong

| What you see | What to do |
|---|---|
| `502 Bad Gateway` | Wealthflow isn't running. Run `pm2 status`, then `pm2 logs wealthflow --lines 30`, and send me a screenshot. |
| The browser can't find the site | DNS isn't ready yet (Part 0 check). Wait and try again. |
| Your other project opens instead of Wealthflow | The `server_name` line doesn't match the subdomain exactly. Fix it in `/etc/nginx/sites-available/wealthflow`, then `nginx -t && systemctl reload nginx`. |
| certbot fails | DNS isn't pointing to the VPS yet, or port 80 is blocked. Check `nslookup` and `ufw allow 'Nginx Full'`. |
| A blank white page | `BASE_PATH` must be empty in `server/.env`. Fix it, then `cd /opt/wealthflow && npm run build && pm2 restart wealthflow`. |
| `node:sqlite` or "Unexpected token" errors in the logs | Node is too old. Do Part 4 option B, then `pm2 delete wealthflow` and start again as in Part 7 with the `--interpreter` line. |
| Upload of a big file fails | Check that `client_max_body_size 50M;` is in the Nginx lines. |
| The other project stopped working | Run `rm /etc/nginx/sites-enabled/wealthflow && systemctl reload nginx`, then send me a screenshot of `nginx -t`. |

When something fails, a screenshot of the command and its output is all I need.
