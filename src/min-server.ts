import express from 'express';
const app = express();
app.get('/', (_req,res)=>res.send('ok'));
app.listen(3000, ()=>console.log('MIN API on :3000'));
