# Outfit App — Setup & Usage Guide

> A beginner-friendly guide. No programming experience needed.

---

## What is this project?

**Outfit App** is a web application that runs in your browser, like a website.
It is built with **React**, which is a tool that makes it easy to create interactive web pages.

You don't need to upload anything to the internet — the app runs only on your computer,
and you visit it by going to a special address in your browser: `http://localhost:3000`.

---

## Understanding the files in this folder

| File | What it does |
|---|---|
| `OutfitApp.jsx` | Your actual app — all the screens, buttons, and logic live here |
| `main.jsx` | The "on switch" — it starts React and loads OutfitApp into the browser |
| `index.html` | The blank page that the browser opens first, then React fills it with your app |
| `vite.config.js` | Settings for Vite, the tool that runs and builds your app |
| `package.json` | A list of all the tools and libraries your app needs to work |
| `node_modules/` | The folder where all those tools get downloaded (created automatically) |

### What is a `.jsx` file?

A `.jsx` file is a JavaScript file that lets you write HTML-like code mixed with JavaScript.
It is the format React uses to describe what the screen should look like.

### What is `npm`?

`npm` stands for **Node Package Manager**. Think of it as an app store for code tools.
When you run `npm install`, it downloads everything your app needs automatically.

---

## First-time setup (do this only once)

### Step 1 — Open the terminal in VSCode

In VSCode, go to the top menu:

```
Terminal → New Terminal
```

A black panel will appear at the bottom of the screen. This is the terminal —
it is where you type commands to talk to your computer.

### Step 2 — Go to your project folder

Type this command and press **Enter**:

```
cd "C:\Users\sarah\Desktop\alfa_project\alfaproject"
```

> This tells the terminal "go inside the alfaproject folder".
> You only need to do this once per terminal session.

### Step 3 — Install the dependencies

Type this and press **Enter**:

```
npm install
```

This downloads all the tools your app needs (React, icons, charts, etc).
It can take 1–2 minutes. You will see a progress bar.

When it is done, a folder called `node_modules` will appear. **Do not delete it.**

---

## Running the app every day

After the first-time setup, every time you want to work on your app:

### Step 1 — Open the terminal

```
Terminal → New Terminal
```

### Step 2 — Go to your project folder

```
cd "C:\Users\sarah\Desktop\alfa_project\alfaproject"
```

### Step 3 — Start the app

```
npm run dev
```

Your browser will open automatically and show your app at `http://localhost:3000`.

---

## Stopping the app

Go back to the terminal and press:

```
Ctrl + C
```

Then type `y` and press **Enter** if it asks you to confirm.

This stops the app from running. The browser page will no longer work until you run `npm run dev` again.

---

## Making changes to your app

All your app code is in [OutfitApp.jsx](OutfitApp.jsx).

1. Open `OutfitApp.jsx` in VSCode
2. Make your changes and save the file (`Ctrl + S`)
3. Your browser will **automatically refresh** and show the changes instantly

You do not need to restart the terminal or run any command when you edit files.

---

## Troubleshooting

### "command not found: npm"
Node.js is not installed. Download it from [nodejs.org](https://nodejs.org) and install it.
Then close and reopen VSCode and try again.

### "Cannot find module"
Run `npm install` again. The `node_modules` folder may be missing or incomplete.

### "Port 3000 already in use"
Another process is using that port. Either:
- Close the other terminal that is running the app
- Or change `port: 3000` to `port: 3001` in `vite.config.js`

### The browser does not open automatically
Go to your browser manually and type `http://localhost:3000` in the address bar.

---

## Libraries used in this app

| Library | What it does |
|---|---|
| `react` | The main tool for building the app interface |
| `react-dom` | Connects React to the actual browser page |
| `lucide-react` | Provides the icons (home, heart, bag, etc.) |
| `recharts` | Draws the charts and graphs in the app |
| `vite` | The tool that runs your app during development |

---

## Quick command reference

| Command | What it does |
|---|---|
| `npm install` | Downloads all dependencies (first time only) |
| `npm run dev` | Starts the app in development mode |
| `npm run build` | Creates a production-ready version of the app |
| `Ctrl + C` | Stops the app |

---

*This project uses React 18 + Vite 6.*
