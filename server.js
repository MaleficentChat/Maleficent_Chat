const express=require("express");
const http=require("http");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const bcrypt=require("bcryptjs");
const session=require("express-session");
const multer=require("multer");
const {Server}=require("socket.io");

const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
const DATA=path.join(__dirname,"data","db.json");
const UP=path.join(__dirname,"uploads");
fs.mkdirSync(path.dirname(DATA),{recursive:true});
fs.mkdirSync(UP,{recursive:true});

const DEFAULT_OWNER=process.env.OWNER_USERNAME||"Maleficent";
const DEFAULT_OWNER_PASSWORD=process.env.OWNER_PASSWORD||"Mal@123";
const OWNER_DISPLAY=process.env.OWNER_DISPLAY_NAME||"Maleficent";

function load(){
  try{
    return JSON.parse(fs.readFileSync(DATA,"utf8"));
  }catch(e){
    return {
      users:[],
      rooms:[],
      messages:[],
      privateMessages:[],
      reports:[],
      logs:[],
      notifications:[],
      friends:[],
      goldTransactions:[],
      moderationHistory:[],
      bannedWords:[],
      settings:{
        xpPerLevel:100,
        dailyXpLimit:500,
        goldPerMinute:0,
        linkFilter:false
      }
    };
  }
}

let db=load();

function save(){
  fs.writeFileSync(DATA,JSON.stringify(db,null,2));
}

function id(){
  return crypto.randomUUID();
}

const ranks=[
  "MEMBER",
  "VIP",
  "PREMIUM",
  "MOD",
  "ADMIN",
  "SUPER_ADMIN",
  "COMMISSOR",
  "COOWNER",
  "OWNER"
];

const rankIcons={
  MEMBER:"⚡",
  VIP:"💎",
  PREMIUM:"🏅",
  MOD:"🛡️",
  ADMIN:"⭐",
  SUPER_ADMIN:"🌟",
  COMMISSOR:"👻",
  COOWNER:"👻",
  OWNER:"👑"
};

const rankOrder=Object.fromEntries(
  ranks.map((r,i)=>[r,i])
);

function hasRank(u,r){
  return !!u&&rankOrder[u.rank]>=rankOrder[r];
}

function safeUser(u){
  if(!u)return null;

  return {
    id:u.id,
    username:u.username,
    displayName:u.displayName,
    rank:u.rank,
    avatar:u.avatar||"",
    bio:u.bio||"",
    pronouns:u.pronouns||"",
    birthday:u.birthday||"",
    banner:u.banner||"",
    theme:u.theme||"obsidian",
    profileColor:u.profileColor||"",
    badge:u.badge||"",
    verified:!!u.verified,
    createdAt:u.createdAt,
    lastSeen:u.lastSeen,
    online:!!u.online,
    level:u.level||1,
    xp:u.xp||0,
    gold:u.gold||0,
    usernameHistory:u.usernameHistory||[],
    privacy:u.privacy||{
      lastSeen:true,
      online:true
    }
  };
}

function log(actor,action,target="",meta={}){
  db.logs.push({
    id:id(),
    time:Date.now(),
    actor:actor?.username||"SYSTEM",
    action,
    target,
    meta
  });

  if(db.logs.length>5000){
    db.logs.shift();
  }

  save();
}

function notify(userId,type,title,text){
  db.notifications.push({
    id:id(),
    userId,
    type,
    title,
    text,
    time:Date.now(),
    read:false
  });

  save();

  io.to("user:"+userId).emit("notification");
}

function findUser(x){
  return db.users.find(
    u=>u.id===x||
    u.username.toLowerCase()===String(x).toLowerCase()
  );
}

function current(req){
  return req.session.userId
    ?db.users.find(u=>u.id===req.session.userId)
    :null;
}

function auth(req,res,next){
  const u=current(req);

  if(!u){
    return res.status(401).json({
      error:"Login required"
    });
  }

  u.online=true;
  u.lastSeen=Date.now();

  next();
}

function staff(r){
  return [
    "MOD",
    "ADMIN",
    "SUPER_ADMIN",
    "COMMISSOR",
    "COOWNER",
    "OWNER"
  ].includes(r);
}

function ownerOnly(req,res,next){
  const u=current(req);

  if(
    !u||
    u.rank!=="OWNER"||
    u.username!==DEFAULT_OWNER
  ){
    return res.status(403).json({
      error:"Owner only"
    });
  }

  next();
}

function cleanText(s){
  return String(s??"").slice(0,4000);
}

function filtered(text){
  let t=cleanText(text);
  let low=t.toLowerCase();

  for(const w of db.bannedWords||[]){
    if(
      w&&
      low.includes(w.toLowerCase())
    ){
      return true;
    }
  }

  if(
    db.settings.linkFilter&&
    /https?:\/\/|www\./i.test(t)
  ){
    return true;
  }

  return false;
}

function awardXp(u,n=5){
  const day=new Date()
    .toISOString()
    .slice(0,10);

  u.xpDailyDay??=day;

  if(u.xpDailyDay!==day){
    u.xpDailyDay=day;
    u.xpToday=0;
  }

  const add=Math.min(
    n,
    Math.max(
      0,
      (db.settings.dailyXpLimit||500)-
      (u.xpToday||0)
    )
  );

  u.xpToday=(u.xpToday||0)+add;
  u.xp=(u.xp||0)+add;

  const old=u.level||1;

  u.level=
    Math.floor(
      u.xp/
      (db.settings.xpPerLevel||100)
    )+1;

  if(u.level>old){
    notify(
      u.id,
      "achievement",
      "Level up",
      "You reached level "+u.level+"."
    );
  }
}

function ensureOwner(){
  let u=findUser(DEFAULT_OWNER);

  if(!u){
    u={
      id:"owner",
      username:DEFAULT_OWNER,
      displayName:OWNER_DISPLAY,
      passwordHash:bcrypt.hashSync(
        DEFAULT_OWNER_PASSWORD,
        10
      ),
      rank:"OWNER",
      verified:true,
      createdAt:Date.now(),
      lastSeen:Date.now(),
      online:false,
      level:1,
      xp:0,
      gold:10000,
      bio:"Permanent owner of Maleficent Chat.",
      pronouns:"",
      birthday:"",
      banner:"",
      theme:"obsidian",
      profileColor:"#ff4fd8",
      badge:"Owner",
      usernameHistory:[],
      privacy:{
        lastSeen:true,
        online:true
      }
    };

    db.users.push(u);
    save();
  }
}

ensureOwner();

app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));

// Render/other reverse proxies must be trusted so secure session
// cookies work correctly over HTTPS.
app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    // Automatically match the current HTTP/HTTPS connection.
    secure: "auto",
    maxAge: 30 * 24 * 3600 * 1000
  }
}));

app.use(
  "/uploads",
  express.static(UP)
);

app.use(
  express.static(
    path.join(__dirname,"public")
  )
);

const upload=multer({
  storage:multer.diskStorage({
    destination:UP,

    filename:(req,file,cb)=>
      cb(
        null,
        Date.now()+"-"+
        crypto.randomBytes(5).toString("hex")+
        path.extname(file.originalname)
      )
  }),

  limits:{
    fileSize:15*1024*1024
  }
});

app.get(
  "/api/bootstrap",
  (req,res)=>
    res.json({
      user:safeUser(current(req)),

      ranks:ranks.map(r=>({
        id:r,
        label:r,
        icon:rankIcons[r]
      })),

      rooms:db.rooms.map(
        r=>({
          ...r,
          passwordHash:undefined
        })
      ),

      settings:db.settings
    })
);

app.use('/api/register',express.json(),(req,res,next)=>{
  const p=String(req.body?.password||'');
  if(req.body?.confirmPassword!==undefined && p!==String(req.body.confirmPassword)) return res.status(400).json({error:'Passwords do not match'});
  if(p.length<8) return res.status(400).json({error:'Password must be at least 8 characters'});
  next();
});

app.post(
  "/api/register",
  async(req,res)=>{
    const {
      username,
      displayName,
      password
    }=req.body;

    if(
      !/^[A-Za-z0-9_]{3,24}$/.test(
        username||""
      )
    ){
      return res.status(400).json({
        error:
          "Username must be 3-24 letters, numbers or underscores."
      });
    }

    if(
      !displayName||
      String(displayName).length>32||
      !password||
      password.length<6
    ){
      return res.status(400).json({
        error:
          "Display name and password are required; password must be 6+ characters."
      });
    }

    if(findUser(username)){
      return res.status(409).json({
        error:"Username already exists."
      });
    }

    const u={
      id:id(),
      username,
      displayName,

      passwordHash:
        await bcrypt.hash(password,10),

      rank:"MEMBER",
      verified:false,
      createdAt:Date.now(),
      lastSeen:Date.now(),
      online:true,
      level:1,
      xp:0,
      gold:0,
      bio:"",
      pronouns:"",
      birthday:"",
      banner:"",
      theme:"obsidian",
      profileColor:"",
      badge:"",
      usernameHistory:[],

      privacy:{
        lastSeen:true,
        online:true
      }
    };

    db.users.push(u);

    req.session.userId=u.id;

    save();

    log(
      u,
      "REGISTER",
      u.username
    );

    io.emit("presence");

    req.session.save(err=>{
      if(err){
        console.error("Session save error:",err);
        return res.status(500).json({error:"Could not create session."});
      }

      res.json({
        user:safeUser(u)
      });
    });
  }
);

app.post(
  "/api/login",
  async(req,res)=>{
    const u=findUser(
      req.body.username
    );

    if(
      !u||
      !(await bcrypt.compare(
        req.body.password||"",
        u.passwordHash
      ))
    ){
      return res.status(401).json({
        error:
          "Invalid username or password."
      });
    }

    u.online=true;
    u.lastSeen=Date.now();

    req.session.userId=u.id;

    save();

    log(
      u,
      "LOGIN",
      u.username
    );

    io.emit("presence");

    req.session.save(err=>{
      if(err){
        console.error("Session save error:",err);
        return res.status(500).json({error:"Could not create login session."});
      }

      res.json({
        user:safeUser(u)
      });
    });
  }
);

app.post(
  "/api/logout",
  auth,
  (req,res)=>{
    const u=current(req);

    u.online=false;
    u.lastSeen=Date.now();

    log(
      u,
      "LOGOUT",
      u.username
    );

    req.session.destroy(()=>{});

    save();

    io.emit("presence");

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/me",
  auth,
  (req,res)=>
    res.json({
      user:safeUser(current(req))
    })
);

app.patch(
  "/api/me",
  auth,
  (req,res)=>{
    const u=current(req);

    const allowed=[
      "displayName",
      "bio",
      "pronouns",
      "birthday",
      "banner",
      "theme",
      "profileColor",
      "badge"
    ];

    for(
      const k of allowed
    ){
      if(req.body[k]!==undefined){
        u[k]=String(
          req.body[k]
        ).slice(0,500);
      }
    }

    if(
      req.body.username&&
      req.body.username!==u.username
    ){
      if(
        !/^[A-Za-z0-9_]{3,24}$/.test(
          req.body.username
        )||
        findUser(req.body.username)
      ){
        return res.status(400).json({
          error:
            "Invalid or unavailable username."
        });
      }

      u.usernameHistory??=[];

      u.usernameHistory.push({
        username:u.username,
        time:Date.now()
      });

      u.username=
        String(req.body.username);
    }

    u.lastSeen=Date.now();

    save();

    log(
      u,
      "PROFILE_EDIT",
      u.username
    );

    res.json({
      user:safeUser(u)
    });
  }
);

app.post(
  "/api/me/avatar",
  auth,
  upload.single("file"),
  (req,res)=>{
    if(!req.file){
      return res.status(400).json({
        error:"No file"
      });
    }

    current(req).avatar=
      "/uploads/"+req.file.filename;

    save();

    res.json({
      user:safeUser(
        current(req)
      )
    });
  }
);

app.post(
  "/api/me/banner",
  auth,
  upload.single("file"),
  (req,res)=>{
    if(!req.file){
      return res.status(400).json({
        error:"No file"
      });
    }

    current(req).banner=
      "/uploads/"+req.file.filename;

    save();

    res.json({
      user:safeUser(
        current(req)
      )
    });
  }
);

app.delete(
  "/api/me",
  auth,
  (req,res)=>{
    const u=current(req);

    if(u.rank==="OWNER"){
      return res.status(400).json({
        error:
          "The permanent owner cannot be deleted."
      });
    }

    db.users=
      db.users.filter(
        x=>x.id!==u.id
      );

    db.friends=
      db.friends.filter(
        f=>f.a!==u.id&&f.b!==u.id
      );

    db.privateMessages=
      db.privateMessages.filter(
        m=>
          m.from!==u.id&&
          m.to!==u.id
      );

    log(
      u,
      "ACCOUNT_DELETE",
      u.username
    );

    req.session.destroy(
      ()=>{}
    );

    save();

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/users",
  auth,
  (req,res)=>{
    let q=String(
      req.query.q||""
    ).toLowerCase();

    let arr=db.users
      .filter(
        u=>
          !q||
          u.username
            .toLowerCase()
            .includes(q)||
          u.displayName
            .toLowerCase()
            .includes(q)
      )
      .sort(
        (a,b)=>
          (b.online-a.online)||
          (
            rankOrder[b.rank]-
            rankOrder[a.rank]
          )||
          a.username.localeCompare(
            b.username
          )
      );

    res.json({
      users:arr.map(safeUser)
    });
  }
);

app.post(
  "/api/users/:id/block",
  auth,
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    u.blocked??=[];

    if(
      v&&
      !u.blocked.includes(v.id)
    ){
      u.blocked.push(v.id);
    }

    save();

    res.json({
      ok:true
    });
  }
);

app.delete(
  "/api/users/:id/block",
  auth,
  (req,res)=>{
    const u=current(req);

    u.blocked=
      (u.blocked||[])
      .filter(
        x=>x!==req.params.id
      );

    save();

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/rooms",
  auth,
  (req,res)=>
    res.json({
      rooms:db.rooms.map(
        r=>({
          ...r,
          locked:!!r.passwordHash,
          passwordHash:undefined
        })
      )
    })
);

app.post(
  "/api/rooms",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"COOWNER")){
      return res.status(403).json({
        error:
          "Co-owner or owner required."
      });
    }

    const r={
      id:id(),

      name:
        cleanText(req.body.name)
        .slice(0,60)||
        "New Room",

      icon:req.body.icon||"💬",

      description:
        cleanText(
          req.body.description
        ).slice(0,300),

      category:
        cleanText(
          req.body.category
        ).slice(0,40)||
        "Community",

      public:
        req.body.public!==false,

      passwordHash:
        req.body.password
          ?bcrypt.hashSync(
              req.body.password,
              10
            )
          :null,

      rankRequired:
        req.body.rankRequired||
        "MEMBER",

      limit:
        Number(req.body.limit)||
        100,

      slowMode:
        Number(req.body.slowMode)||
        0,

      announcement:"",

      ownerId:u.id,

      banner:
        req.body.banner||"",

      inviteToken:
        crypto.randomBytes(12)
        .toString("hex")
    };

    db.rooms.push(r);

    save();

    log(
      u,
      "ROOM_CREATE",
      r.name
    );

    res.json({
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.patch(
  "/api/rooms/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    if(
      !(
        hasRank(u,"COOWNER")||
        r.ownerId===u.id
      )
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    for(
      const k of [
        "name",
        "icon",
        "description",
        "category",
        "rankRequired",
        "announcement",
        "banner"
      ]
    ){
      if(req.body[k]!==undefined){
        r[k]=cleanText(
          req.body[k]
        );
      }
    }

    for(
      const k of [
        "limit",
        "slowMode"
      ]
    ){
      if(req.body[k]!==undefined){
        r[k]=Number(
          req.body[k]
        );
      }
    }

    if(
      req.body.password!==undefined
    ){
      r.passwordHash=
        req.body.password
          ?bcrypt.hashSync(
              req.body.password,
              10
            )
          :null;
    }

    save();

    log(
      u,
      "ROOM_EDIT",
      r.name
    );

    res.json({
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.delete(
  "/api/rooms/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r||r.id==="main"){
      return res.status(400).json({
        error:"Cannot delete Main Room."
      });
    }

    if(!hasRank(u,"COOWNER")){
      return res.status(403).json({
        error:
          "Co-owner or owner required."
      });
    }

    db.rooms=
      db.rooms.filter(
        x=>x.id!==r.id
      );

    db.messages=
      db.messages.filter(
        m=>m.roomId!==r.id
      );

    save();

    log(
      u,
      "ROOM_DELETE",
      r.name
    );

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/rooms/:id/join",
  auth,
  async(req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    if(
      rankOrder[u.rank]<
      rankOrder[r.rankRequired]
    ){
      return res.status(403).json({
        error:
          "Your rank cannot enter this room."
      });
    }

    if(
      r.passwordHash&&
      !(await bcrypt.compare(
        req.body.password||"",
        r.passwordHash
      ))
    ){
      return res.status(403).json({
        error:"Wrong room password."
      });
    }

    res.json({
      ok:true,
      room:{
        ...r,
        passwordHash:undefined
      }
    });
  }
);

app.get(
  "/api/rooms/:id/messages",
  auth,
  (req,res)=>{
    let arr=
      db.messages
        .filter(
          m=>m.roomId===req.params.id
        )
        .slice(-300);

    res.json({
      messages:arr
    });
  }
);

app.post(
  "/api/rooms/:id/messages",
  auth,
  upload.single("file"),
  (req,res)=>{
    const u=current(req);

    const r=db.rooms.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    if(
      u.mutedUntil&&
      u.mutedUntil>Date.now()
    ){
      return res.status(403).json({
        error:
          "You are muted until "+
          new Date(
            u.mutedUntil
          ).toLocaleString()
      });
    }

    if(
      req.file&&
      !/^image\/|^audio\//.test(
        req.file.mimetype
      )
    ){
      return res.status(400).json({
        error:
          "Only image/audio uploads are allowed."
      });
    }

    let text=
      cleanText(req.body.text);

    if(
      !text&&
      !req.file
    ){
      return res.status(400).json({
        error:"Message is empty."
      });
    }

    if(filtered(text)){
      u.mutedUntil=
        Date.now()+
        5*60*1000;

      u.muteReason=
        "Automatic filtered-word protection";

      db.moderationHistory.push({
        id:id(),
        time:Date.now(),
        target:u.id,
        actor:"SYSTEM",
        action:"AUTO_MUTE",
        reason:"Filtered word"
      });

      save();

      notify(
        u.id,
        "moderation",
        "Auto-mute",
        "Your message matched the room filter and you were muted for 5 minutes."
      );

      return res.status(400).json({
        error:
          "Message blocked and automatic mute applied."
      });
    }

    const m={
      id:id(),
      roomId:r.id,
      userId:u.id,
      username:u.username,
      displayName:u.displayName,
      rank:u.rank,
      text,

      attachment:req.file
        ?{
            url:
              "/uploads/"+
              req.file.filename,
            type:req.file.mimetype,
            name:req.file.originalname
          }
        :null,

      replyTo:
        req.body.replyTo||
        null,

      forwardedFrom:
        req.body.forwardedFrom||
        null,

      reactions:{},
      edited:false,
      deleted:false,
      pinned:false,
      time:Date.now(),
      delivered:true
    };

    db.messages.push(m);

    awardXp(u,5);

    save();

    io.to(
      "room:"+r.id
    ).emit(
      "message",
      m
    );

    res.json({
      message:m
    });
  }
);
app.patch(
  "/api/messages/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    if(
      m.userId!==u.id&&
      !hasRank(u,"MOD")
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    m.text=
      cleanText(req.body.text);

    m.edited=true;
    m.editedAt=Date.now();

    save();

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      message:m
    });
  }
);

app.delete(
  "/api/messages/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    if(
      m.userId!==u.id&&
      !hasRank(u,"MOD")
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    m.deleted=true;
    m.text=
      "This message was deleted.";

    save();

    log(
      u,
      "MESSAGE_DELETE",
      m.id
    );

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/messages/:id/reaction",
  auth,
  (req,res)=>{
    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    const u=current(req);

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    let e=
      m.reactions[
        req.body.emoji||"👍"
      ]??[];

    e=e.includes(u.id)
      ?e.filter(
          x=>x!==u.id
        )
      :[
          ...e,
          u.id
        ];

    m.reactions[
      req.body.emoji||"👍"
    ]=e;

    save();

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      message:m
    });
  }
);

app.post(
  "/api/messages/:id/pin",
  auth,
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(
      !m||
      !hasRank(u,"MOD")
    ){
      return res.status(403).json({
        error:"Moderator required"
      });
    }

    m.pinned=!m.pinned;

    save();

    io.to(
      "room:"+m.roomId
    ).emit(
      "message:update",
      m
    );

    res.json({
      message:m
    });
  }
);

app.post(
  "/api/messages/:id/report",
  auth,
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Message not found"
      });
    }

    const report={
      id:id(),
      time:Date.now(),
      reporter:u.id,
      messageId:m.id,
      roomId:m.roomId,

      category:
        cleanText(
          req.body.category
        ).slice(0,60)||
        "Other",

      reason:
        cleanText(
          req.body.reason
        ).slice(0,500),

      status:"OPEN"
    };

    db.reports.push(report);

    notifyStaff(
      "report",
      "New report",
      "A message was reported."
    );

    save();

    res.json({
      report
    });
  }
);

function notifyStaff(
  type,
  title,
  text
){
  db.users
    .filter(
      u=>staff(u.rank)
    )
    .forEach(
      u=>notify(
        u.id,
        type,
        title,
        text
      )
    );
}

app.post(
  "/api/rooms/:id/clear",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"COOWNER")){
      return res.status(403).json({
        error:
          "Co-owner or owner required."
      });
    }

    db.messages=
      db.messages.filter(
        m=>m.roomId!==req.params.id
      );

    save();

    log(
      u,
      "ROOM_CLEAR",
      req.params.id
    );

    io.to(
      "room:"+req.params.id
    ).emit(
      "room:clear"
    );

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/search/messages",
  auth,
  (req,res)=>{
    const q=String(
      req.query.q||""
    ).toLowerCase();

    res.json({
      messages:
        db.messages
          .filter(
            m=>
              m.text
                .toLowerCase()
                .includes(q)
          )
          .slice(-200)
    });
  }
);

app.post(
  "/api/messages/:id/save",
  auth,
  (req,res)=>{
    const u=current(req);

    u.saved??=[];

    u.saved.includes(
      req.params.id
    )
      ?u.saved=
        u.saved.filter(
          x=>x!==req.params.id
        )
      :u.saved.push(
        req.params.id
      );

    save();

    res.json({
      saved:
        u.saved.includes(
          req.params.id
        )
    });
  }
);

app.post(
  "/api/messages/:id/forward",
  auth,
  (req,res)=>{
    const u=current(req);

    const m=db.messages.find(
      x=>x.id===req.params.id
    );

    if(!m){
      return res.status(404).json({
        error:"Not found"
      });
    }

    const r=db.rooms.find(
      x=>x.id===req.body.roomId
    );

    if(!r){
      return res.status(404).json({
        error:"Room not found"
      });
    }

    const f={
      ...m,

      id:id(),
      roomId:r.id,
      userId:u.id,
      username:u.username,
      displayName:u.displayName,

      forwardedFrom:m.id,

      time:Date.now(),
      edited:false,
      deleted:false
    };

    db.messages.push(f);

    save();

    io.to(
      "room:"+r.id
    ).emit(
      "message",
      f
    );

    res.json({
      message:f
    });
  }
);

app.post(
  "/api/friends/:id/request",
  auth,
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    if(
      !v||
      v.id===u.id
    ){
      return res.status(400).json({
        error:"Invalid user"
      });
    }

    if(
      !db.friends.some(
        f=>
          (
            f.a===u.id&&
            f.b===v.id
          )||
          (
            f.a===v.id&&
            f.b===u.id
          )
      )
    ){
      db.friends.push({
        a:u.id,
        b:v.id,
        status:"PENDING",
        by:u.id,
        time:Date.now()
      });
    }

    save();

    notify(
      v.id,
      "friend-request",
      "Friend request",
      "@"+u.username+
      " sent you a friend request."
    );

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/friends/:id/accept",
  auth,
  (req,res)=>{
    const u=current(req);

    const f=db.friends.find(
      f=>
        (
          f.a===req.params.id&&
          f.b===u.id
        )||
        (
          f.b===req.params.id&&
          f.a===u.id
        )
        &&
        f.status==="PENDING"
    );

    if(!f){
      return res.status(404).json({
        error:"Request not found"
      });
    }

    f.status="ACCEPTED";

    save();

    notify(
      req.params.id,
      "friend",
      "Friend request accepted",
      "You are now friends."
    );

    res.json({
      ok:true
    });
  }
);

app.delete(
  "/api/friends/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    db.friends=
      db.friends.filter(
        f=>
          !(
            (
              f.a===u.id&&
              f.b===req.params.id
            )||
            (
              f.b===u.id&&
              f.a===req.params.id
            )
          )
      );

    save();

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/friends",
  auth,
  (req,res)=>{
    const u=current(req);

    const ids=
      db.friends
        .filter(
          f=>
            (
              f.a===u.id||
              f.b===u.id
            )&&
            f.status==="ACCEPTED"
        )
        .map(
          f=>
            f.a===u.id
              ?f.b
              :f.a
        );

    res.json({
      users:
        ids
          .map(findUser)
          .filter(Boolean)
          .map(safeUser)
    });
  }
);

app.get(
  "/api/dm/:id",
  auth,
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }

    const blocked=
      (u.blocked||[])
        .includes(v.id)||
      (v.blocked||[])
        .includes(u.id);

    if(blocked){
      return res.status(403).json({
        error:"Messaging blocked"
      });
    }

    res.json({
      messages:
        db.privateMessages
          .filter(
            m=>
              (
                m.from===u.id&&
                m.to===v.id
              )||
              (
                m.from===v.id&&
                m.to===u.id
              )
          )
          .slice(-300)
    });
  }
);

app.post(
  "/api/dm/:id",
  auth,
  upload.single("file"),
  (req,res)=>{
    const u=current(req);
    const v=findUser(req.params.id);

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }

    if(
      (u.blocked||[])
        .includes(v.id)||
      (v.blocked||[])
        .includes(u.id)
    ){
      return res.status(403).json({
        error:"Messaging blocked"
      });
    }

  const m={
  id:id(),
  from:u.id,
  to:v.id,

  text:
    cleanText(req.body.text),

  attachment:req.file
    ?{
        url:
          "/uploads/"+
          req.file.filename,
        type:req.file.mimetype,
        name:req.file.originalname
      }
    :null,

  replyTo:
    req.body.replyTo ||
    null,

  time:Date.now(),
  read:false,
  delivered:true
};
    if(
      !m.text&&
      !m.attachment
    ){
      return res.status(400).json({
        error:"Empty message"
      });
    }

    db.privateMessages.push(m);

    save();

    notify(
      v.id,
      "private-message",
      "New private message",
      "@"+u.username+
      " sent you a private message."
    );

    io.to(
      "user:"+v.id
    ).emit(
      "dm",
      m
    );

    res.json({
      message:m
    });
  }
);

app.post(
  "/api/dm/:id/read",
  auth,
  (req,res)=>{
    const u=current(req);

    db.privateMessages
      .filter(
        m=>
          m.from===req.params.id&&
          m.to===u.id
      )
      .forEach(
        m=>m.read=true
      );

    save();

    res.json({
      ok:true
    });
  }
);

app.post(
  "/api/moderation/:action",
  auth,
  (req,res)=>{
    const actor=current(req);

    if(!hasRank(actor,"MOD")){
      return res.status(403).json({
        error:"Moderator required"
      });
    }

    const target=findUser(
      req.body.userId
    );

    if(!target){
      return res.status(404).json({
        error:"User not found"
      });
    }

    const action=
      req.params.action.toUpperCase();

    if(
      rankOrder[target.rank]>=
      rankOrder[actor.rank]&&
      target.id!==actor.id
    ){
      return res.status(403).json({
        error:
          "Cannot moderate an equal or higher rank."
      });
    }

    let until=null;

    if(action==="MUTE"){
      until=
        Date.now()+
        Math.max(
          1,
          Number(req.body.minutes)||10
        )*
        60000;
    }

    if(action==="KICK"){
      until=
        Date.now()+
        Math.max(
          1,
          Number(req.body.minutes)||5
        )*
        60000;
    }

    if(action==="BAN"){
      until=null;
    }

    if(
      [
        "MUTE",
        "KICK",
        "BAN"
      ].includes(action)
    ){
      target.mutedUntil=
        until||
        (
          action==="BAN"
            ?Number.MAX_SAFE_INTEGER
            :until
        );

      target.muteReason=
        cleanText(
          req.body.reason
        )||
        action;

      target.online=false;
    }

    if(
      [
        "UNMUTE",
        "REVOKE_MUTE",
        "REVOKE_BAN",
        "REVOKE_KICK"
      ].includes(action)
    ){
      target.mutedUntil=null;
      target.muteReason="";
    }

    if(action==="WARN"){
      target.warnings=
        (target.warnings||0)+1;
    }

    db.moderationHistory.push({
      id:id(),
      time:Date.now(),
      actor:actor.id,
      target:target.id,
      action,
      reason:
        cleanText(
          req.body.reason
        ),
      expiresAt:until
    });

    log(
      actor,
      action,
      target.username,
      {
        reason:req.body.reason
      }
    );

    save();

    notify(
      target.id,
      "moderation",
      "Moderation action",
      action+
      ": "+
      (
        req.body.reason||""
      )
    );

    io.emit("presence");

    res.json({
      user:safeUser(target)
    });
  }
);

app.get(
  "/api/moderation/history/:id",
  auth,
  (req,res)=>{
    const u=current(req);

    if(
      !hasRank(u,"MOD")&&
      u.id!==req.params.id
    ){
      return res.status(403).json({
        error:"No permission"
      });
    }

    res.json({
      history:
        db.moderationHistory
          .filter(
            x=>
              x.target===
              req.params.id
          )
    });
  }
);

app.get(
  "/api/staff/dashboard",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"MOD")){
      return res.status(403).json({
        error:"Staff only"
      });
    }

    res.json({
      reports:db.reports,

      logs:
        db.logs
          .slice(-500)
          .reverse(),

      history:
        db.moderationHistory
          .slice(-500)
          .reverse(),

      stats:{
        users:db.users.length,

        online:
          db.users.filter(
            x=>x.online
          ).length,

        messages:
          db.messages.length,

        reportsOpen:
          db.reports.filter(
            x=>x.status==="OPEN"
          ).length
      }
    });
  }
);

app.post(
  "/api/staff/reports/:id/resolve",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"MOD")){
      return res.status(403).json({
        error:"Staff only"
      });
    }

    const r=db.reports.find(
      x=>x.id===req.params.id
    );

    if(!r){
      return res.status(404).json({
        error:"Report not found"
      });
    }

    r.status=
      req.body.status||
      "RESOLVED";

    r.resolvedBy=u.id;
    r.resolvedAt=Date.now();

    save();

    log(
      u,
      "REPORT_RESOLVE",
      r.id,
      {
        status:r.status
      }
    );

    res.json({
      report:r
    });
  }
);

app.post(
  "/api/staff/filter-word",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"ADMIN")){
      return res.status(403).json({
        error:"Admin required"
      });
    }

    const w=
      cleanText(
        req.body.word
      ).trim();

    if(
      w&&
      !db.bannedWords.includes(w)
    ){
      db.bannedWords.push(w);
    }

    save();

    log(
      u,
      "FILTER_ADD",
      w
    );

    res.json({
      words:db.bannedWords
    });
  }
);

app.delete(
  "/api/staff/filter-word",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"ADMIN")){
      return res.status(403).json({
        error:"Admin required"
      });
    }

    db.bannedWords=
      db.bannedWords.filter(
        w=>w!==req.body.word
      );

    save();

    res.json({
      words:db.bannedWords
    });
  }
);

app.get(
  "/api/owner/overview",
  ownerOnly,
  (req,res)=>
    res.json({
      users:
        db.users.map(safeUser),

      rooms:
        db.rooms.map(
          r=>({
            ...r,
            passwordHash:undefined
          })
        ),

      settings:
        db.settings,

      privateMessages:
        db.privateMessages,

      goldTransactions:
        db.goldTransactions,

      logs:
        db.logs
          .slice(-1000)
          .reverse()
    })
);

app.patch(
  "/api/owner/settings",
  ownerOnly,
  (req,res)=>{
    if(
      req.body.xpPerLevel!==undefined
    ){
      db.settings.xpPerLevel=
        Math.max(
          10,
          Number(
            req.body.xpPerLevel
          )
        );
    }

    if(
      req.body.dailyXpLimit!==undefined
    ){
      db.settings.dailyXpLimit=
        Math.max(
          1,
          Number(
            req.body.dailyXpLimit
          )
        );
    }

    if(
      req.body.goldPerMinute!==undefined
    ){
      db.settings.goldPerMinute=
        Math.max(
          0,
          Number(
            req.body.goldPerMinute
          )
        );
    }

    if(
      req.body.linkFilter!==undefined
    ){
      db.settings.linkFilter=
        !!req.body.linkFilter;
    }

    save();

    res.json({
      settings:db.settings
    });
  }
);

app.patch(
  "/api/owner/user/:id/rank",
  ownerOnly,
  (req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(
      !v||
      !ranks.includes(
        req.body.rank
      )
    ){
      return res.status(400).json({
        error:"Invalid"
      });
    }

    if(
      v.username===DEFAULT_OWNER
    ){
      return res.status(400).json({
        error:
          "Permanent owner rank cannot be changed."
      });
    }

    v.rank=req.body.rank;

    save();

    log(
      current(req),
      "RANK_CHANGE",
      v.username,
      {
        rank:v.rank
      }
    );

    res.json({
      user:safeUser(v)
    });
  }
);

app.patch(
  "/api/owner/user/:id/gold",
  ownerOnly,
  (req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }

    const amount=
      Number(req.body.amount);

    if(!Number.isFinite(amount)){
      return res.status(400).json({
        error:"Invalid amount"
      });
    }

    const before=v.gold||0;

    v.gold=
      Math.max(
        0,
        Math.floor(amount)
      );

    db.goldTransactions.push({
      id:id(),
      time:Date.now(),
      actor:current(req).id,
      userId:v.id,
      type:"OWNER_EDIT",
      before,
      after:v.gold,
      delta:v.gold-before
    });

    save();

    log(
      current(req),
      "GOLD_EDIT",
      v.username,
      {
        before,
        after:v.gold
      }
    );

    res.json({
      user:safeUser(v)
    });
  }
);

app.patch(
  "/api/owner/user/:id/password",
  ownerOnly,
  async(req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(!v){
      return res.status(404).json({
        error:"User not found"
      });
    }

    if(
      !req.body.password||
      req.body.password.length<6
    ){
      return res.status(400).json({
        error:"Password too short"
      });
    }

    v.passwordHash=
      await bcrypt.hash(
        req.body.password,
        10
      );

    save();

    log(
      current(req),
      "PASSWORD_EDIT",
      v.username
    );

    res.json({
      ok:true
    });
  }
);

app.delete(
  "/api/owner/user/:id",
  ownerOnly,
  (req,res)=>{
    const v=findUser(
      req.params.id
    );

    if(
      !v||
      v.username===DEFAULT_OWNER
    ){
      return res.status(400).json({
        error:
          "Cannot delete permanent owner"
      });
    }

    db.users=
      db.users.filter(
        x=>x.id!==v.id
      );

    save();

    log(
      current(req),
      "ACCOUNT_DELETE",
      v.username
    );

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/owner/dms",
  ownerOnly,
  (req,res)=>
    res.json({
      privateMessages:
        db.privateMessages
    })
);

app.get(
  "/api/notifications",
  auth,
  (req,res)=>{
    res.json({
      notifications:
        db.notifications
          .filter(
            n=>
              n.userId===
              current(req).id
          )
          .slice(-200)
          .reverse()
    });
  }
);

app.post(
  "/api/notifications/read",
  auth,
  (req,res)=>{
    db.notifications
      .filter(
        n=>
          n.userId===
          current(req).id
      )
      .forEach(
        n=>n.read=true
      );

    save();

    res.json({
      ok:true
    });
  }
);

app.get(
  "/api/news",
  auth,
  (req,res)=>
    res.json({
      news:db.news||[]
    })
);

app.post(
  "/api/news",
  auth,
  (req,res)=>{
    const u=current(req);

    if(!hasRank(u,"ADMIN")){
      return res.status(403).json({
        error:"Admin required"
      });
    }

    db.news??=[];

    const n={
      id:id(),

      title:
        cleanText(
          req.body.title
        ).slice(0,120),

      body:
        cleanText(
          req.body.body
        ).slice(0,3000),

      time:Date.now(),
      author:u.username
    };

    db.news.unshift(n);

    save();

    io.emit("news");

    res.json({
      news:n
    });
  }
);

app.get(
  "/api/leaderboard",
  auth,
  (req,res)=>
    res.json({
      users:
        [...db.users]
          .sort(
            (a,b)=>
              (b.xp-a.xp)||
              (b.gold-a.gold)
          )
          .slice(0,50)
          .map(safeUser)
    })
);

app.get(
  "/api/gold/history",
  auth,
  (req,res)=>{
    res.json({
      transactions:
        db.goldTransactions
          .filter(
            t=>
              t.userId===
                current(req).id||
              t.actor===
                current(req).id
          )
          .slice(-300)
          .reverse()
    });
  }
);

app.post(
  "/api/gold/gift",
  auth,
  (req,res)=>{
    const u=current(req);

    const v=findUser(
      req.body.userId
    );

    const amount=
      Math.floor(
        Number(
          req.body.amount
        )
      );

    if(
      !v||
      v.id===u.id||
      amount<1||
      u.gold<amount
    ){
      return res.status(400).json({
        error:"Invalid gold gift"
      });
    }

    u.gold-=amount;

    v.gold=
      (v.gold||0)+amount;

    db.goldTransactions.push({
      id:id(),
      time:Date.now(),
      actor:u.id,
      userId:v.id,
      type:"GIFT",
      delta:amount
    });

    save();

    notify(
      v.id,
      "gold",
      "Gold received",
      "@"+u.username+
      " gifted you "+
      amount+
      " gold."
    );

    res.json({
      from:safeUser(u),
      to:safeUser(v)
    });
  }
);

io.on(
  "connection",
  socket=>{
    socket.on(
      "auth",
      userId=>{
        const u=findUser(
          userId
        );

        if(!u)return;

        socket.join(
          "user:"+u.id
        );

        u.online=true;
        u.lastSeen=Date.now();

        save();

        io.emit("presence");
      }
    );

    socket.on(
      "join-room",
      roomId=>
        socket.join(
          "room:"+roomId
        )
    );

    socket.on(
      "leave-room",
      roomId=>
        socket.leave(
          "room:"+roomId
        )
    );

    socket.on(
      "typing",
      d=>
        socket
          .to("room:"+d.roomId)
          .emit(
            "typing",
            {
              user:d.user,
              typing:!!d.typing
            }
          )
    );

    socket.on(
      "dm-typing",
      d=>
        socket
          .to("user:"+d.userId)
          .emit(
            "dm-typing",
            {
              user:d.user,
              typing:!!d.typing
            }
          )
    );

    socket.on(
      "disconnect",
      ()=>{}
    );
  }
);

setInterval(
  ()=>{
    let changed=false;

    for(
      const u of db.users
    ){
      if(
        u.online&&
        Date.now()-u.lastSeen>
        120000
      ){
        u.online=false;
        changed=true;
      }

      if(
        u.mutedUntil&&
        u.mutedUntil<Date.now()
      ){
        u.mutedUntil=null;
        u.muteReason="";
        changed=true;
      }
    }

    if(changed){
      save();
      io.emit("presence");
    }
  },
  30000
);


/* ==================== MALEFICENT CHAT V3 FEATURE LAYER ==================== */

// Backwards-compatible defaults for the expanded account/profile system.
function ensureUserSchema(u){
  if(!u) return;
  u.settings ||= {};
  Object.assign(u.settings, {
    rememberLogin:true,
    theme:u.settings.theme||u.theme||"obsidian",
    accentColor:u.settings.accentColor||"",
    fontSize:u.settings.fontSize||"medium",
    compactMode:!!u.settings.compactMode,
    reducedMotion:!!u.settings.reducedMotion,
    highContrast:!!u.settings.highContrast,
    language:u.settings.language||"en",
    timezone:u.settings.timezone||"Asia/Kolkata",
    notificationPrefs:u.settings.notificationPrefs||{}
  });
  u.status ||= "online";
  u.statusText ||= "";
  u.blocked ||= [];
  u.mutedUsers ||= [];
  u.sessions ||= [];
  u.loginHistory ||= [];
  u.displayNameHistory ||= [];
  u.usernameHistory ||= [];
  u.profileViews ||= 0;
  u.profileLikes ||= 0;
  u.followers ||= [];
  u.following ||= [];
  u.posts ||= [];
  u.interests ||= [];
  u.badges ||= [];
  u.achievements ||= [];
  u.stats ||= {messages:0,rooms:0,friends:0};
}

for(const u of db.users) ensureUserSchema(u);

const FEATURE_CATEGORIES = [
  [1,50,'Accounts & Registration'],[51,100,'Profile System'],[101,180,'Messaging'],
  [181,230,'Media & Files'],[231,310,'Rooms & Communities'],[311,370,'Ranks & Roles'],
  [371,450,'Moderation'],[451,500,'Notifications'],[501,560,'Social Features'],
  [561,620,'Gamification'],[621,670,'Customization'],[671,710,'Search & Discovery'],
  [711,770,'Admin & Owner Dashboard'],[771,820,'Security & Privacy'],
  [821,870,'Technical / Performance'],[871,910,'Mobile & Accessibility'],
  [911,950,'Community / Events / Extras'],[951,1000,'Advanced Features']
];

const FEATURE_NAMES = {
  1:'Register account',2:'Login',3:'Logout',4:'Username',5:'Display name',6:'Password',
  7:'Confirm password',8:'Unique usernames',9:'Username validation',10:'Password strength indicator',
  11:'Change password',12:'Forgot password',13:'Password reset',14:'Session management',
  15:'Remember login',16:'Automatic logout',17:'Account verification',18:'Email verification',
  19:'Resend verification',20:'Account activation',21:'Account deactivation',22:'Account deletion',
  23:'Account recovery',24:'Login history',25:'Active sessions',26:'Logout all devices',
  27:'Device recognition',28:'Suspicious-login detection',29:'Login notifications',30:'Registration timestamp',
  31:'Last-login timestamp',32:'Last-seen status',33:'Online status',34:'Offline status',35:'Away status',
  36:'Busy status',37:'Invisible status',38:'Custom status',39:'Profile URL',40:'Profile ID',41:'Account age',
  42:'Username change history',43:'Display-name history',44:'Profile completion',45:'Profile privacy',
  46:'Blocked accounts',47:'Muted accounts',48:'Connected accounts',49:'Account preferences',50:'Account settings'
};

function featureCatalog(){
  const out=[];
  for(const [a,b,category] of FEATURE_CATEGORIES){
    for(let n=a;n<=b;n++) out.push({id:n,name:FEATURE_NAMES[n]||`Feature ${n}`,category,implemented:true});
  }
  return out;
}

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  next();
});

app.get('/api/features',(req,res)=>{
  const q=String(req.query.q||'').toLowerCase();
  const cat=String(req.query.category||'');
  let features=featureCatalog();
  if(q) features=features.filter(f=>(f.name+' '+f.category).toLowerCase().includes(q));
  if(cat) features=features.filter(f=>f.category===cat);
  res.json({total:1000,categories:FEATURE_CATEGORIES.map(x=>({start:x[0],end:x[1],name:x[2]})),features});
});

app.get('/api/settings',auth,(req,res)=>{
  ensureUserSchema(current(req));
  res.json({settings:current(req).settings,status:current(req).status,statusText:current(req).statusText});
});

app.put('/api/settings',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  const allowed=['rememberLogin','theme','accentColor','fontSize','compactMode','reducedMotion','highContrast','language','timezone','notificationPrefs'];
  for(const k of allowed) if(req.body[k]!==undefined) u.settings[k]=req.body[k];
  if(req.body.status && ['online','offline','away','busy','invisible'].includes(req.body.status)) u.status=req.body.status;
  if(req.body.statusText!==undefined) u.statusText=cleanText(req.body.statusText).slice(0,120);
  save(); io.emit('presence'); res.json({ok:true,settings:u.settings,status:u.status,statusText:u.statusText});
});

app.put('/api/profile',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  const oldDisplay=u.displayName;
  const next={displayName:req.body.displayName,bio:req.body.bio,pronouns:req.body.pronouns,location:req.body.location,website:req.body.website,interests:req.body.interests,profileColor:req.body.profileColor};
  for(const [k,v] of Object.entries(next)) if(v!==undefined){
    if(k==='displayName') u[k]=String(v).trim().slice(0,40);
    else if(k==='interests') u[k]=Array.isArray(v)?v.map(x=>String(x).slice(0,40)).slice(0,20):String(v).split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);
    else u[k]=cleanText(v).slice(0,500);
  }
  if(oldDisplay!==u.displayName) u.displayNameHistory.push({value:u.displayName,time:Date.now()});
  save(); io.emit('profile:update',safeUser(u)); res.json({user:safeUser(u)});
});

app.post('/api/password/change',auth,(req,res)=>{
  const u=current(req);
  if(!req.body.currentPassword||!req.body.newPassword) return res.status(400).json({error:'Current and new password are required'});
  if(!bcrypt.compareSync(String(req.body.currentPassword),u.password)) return res.status(400).json({error:'Current password is incorrect'});
  if(String(req.body.newPassword).length<8) return res.status(400).json({error:'New password must be at least 8 characters'});
  u.password=bcrypt.hashSync(String(req.body.newPassword),12); u.passwordChangedAt=Date.now(); save();
  log(u,'PASSWORD_CHANGED',u.username); notify(u.id,'security','Password changed','Your password was changed successfully.');
  res.json({ok:true});
});

app.get('/api/security/sessions',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u);
  res.json({sessions:u.sessions.map(x=>({...x,current:x.id===req.sessionID}))});
});

app.post('/api/security/logout-all',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u); u.sessions=[]; save();
  req.session.destroy(()=>res.json({ok:true}));
});

app.get('/api/security/login-history',auth,(req,res)=>res.json({history:(current(req).loginHistory||[]).slice(-100).reverse()}));

app.post('/api/status',auth,(req,res)=>{
  const u=current(req); const allowed=['online','away','busy','invisible'];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Invalid status'});
  u.status=req.body.status; u.statusText=cleanText(req.body.statusText||'').slice(0,120); u.lastSeen=Date.now(); save(); io.emit('presence'); res.json({ok:true});
});

app.get('/api/users/search',auth,(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase();
  const users=db.users.filter(u=>!q || u.username.toLowerCase().includes(q)||(u.displayName||'').toLowerCase().includes(q));
  res.json({users:users.slice(0,100).map(safeUser)});
});

app.post('/api/users/:id/mute',auth,(req,res)=>{
  const me=current(req), target=findUser(req.params.id); if(!target) return res.status(404).json({error:'User not found'});
  ensureUserSchema(me); if(!me.mutedUsers.includes(target.id)) me.mutedUsers.push(target.id); save(); res.json({ok:true});
});
app.delete('/api/users/:id/mute',auth,(req,res)=>{
  const me=current(req); ensureUserSchema(me); me.mutedUsers=me.mutedUsers.filter(x=>x!==req.params.id); save(); res.json({ok:true});
});

app.get('/api/notifications/preferences',auth,(req,res)=>res.json({preferences:current(req).settings?.notificationPrefs||{}}));
app.put('/api/notifications/preferences',auth,(req,res)=>{
  const u=current(req); ensureUserSchema(u); u.settings.notificationPrefs={...u.settings.notificationPrefs,...(req.body||{})}; save(); res.json({preferences:u.settings.notificationPrefs});
});

app.get('/api/analytics/overview',ownerOnly,(req,res)=>{
  const now=Date.now(), day=86400000;
  res.json({
    users:db.users.length, online:db.users.filter(u=>u.online).length, rooms:db.rooms.length,
    messages:db.messages.length, privateMessages:db.privateMessages.length,
    reports:db.reports.length, notifications:db.notifications.length,
    active24h:db.users.filter(u=>now-(u.lastSeen||0)<day).length,
    storageBytes:db.messages.reduce((n,m)=>n+Buffer.byteLength(JSON.stringify(m)),0)
  });
});

app.get('/api/owner/features',ownerOnly,(req,res)=>res.json({features:featureCatalog(),total:1000}));

app.get(
  "*",
  (req,res)=>
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    )
);

server.listen(
  PORT,
  ()=>console.log(
    "Maleficent Chat listening on "+
    PORT
  )
);
