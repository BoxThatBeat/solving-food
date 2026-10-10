#!/usr/bin/env bash
# temp helper: sign a pw session in as dev@example.com (emulator). usage: .signin.sh <session> <baseurl>
s=$1; base=$2
scripts/pw -s=$s goto $base/sign-in >/dev/null
scripts/pw -s=$s run-code "async page => { await page.getByLabel('Email', { exact: true }).fill('dev@example.com'); await page.getByRole('button', { name: 'Send sign-in link' }).click(); }" >/dev/null
sleep 2
link=$(curl -s http://127.0.0.1:9099/emulator/v1/projects/solvingfood/oobCodes | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d).oobCodes.filter(c=>c.email==="dev@example.com"&&c.requestType==="EMAIL_SIGNIN").at(-1);const l=new URL(j.oobLink);const t=new URL(l.searchParams.get("continueUrl"));for(const k of ["mode","oobCode","apiKey","lang"]){const v=l.searchParams.get(k);if(v)t.searchParams.set(k,v)}console.log(t.toString())})')
scripts/pw -s=$s goto "$link" >/dev/null
sleep 3
scripts/pw -s=$s eval "location.href"
