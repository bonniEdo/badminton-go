1. 啟動 >> node app.js

2. 創建帳號 >> POST http://localhost:3000/api/user/create

>> {
    "username":"bonnie",
    "email": "bonnie2@ryzo.io",
    "password": "fuco1234"
}

3. 登入 >> POST http://localhost:3000/api/user/login

{
    "email": "bonnielin@ryzo.io",
    "password": "fuco1234"
}

>> 拿 Bearer token

4. 創建遊戲 >> POST http://localhost:3000/api/games/create

>> 塞 token
>> {
    "title": "今天打球",
    "gameDate": "2025-12-25",
    "gameTime": "21:00",
    "location": "長安國小",
    "maxPlayers": "1",
    "price": "200"
}

5. 刪除遊戲 >> DELETE http://localhost:3000/api/games/delete/:id

>> 塞 token
>>  {
    "userId": "1"
}

5. 報名遊戲 >> POST http://localhost:3000/api/games/:id/join
   
>> 塞 token
>>  {
    "userId":"bonnie",
    "phone":"0912345678"
}



6. 取消報名 DELETE http://localhost:3000/api/games/:id/join
   
>> 塞 token
>>  {
    "userId":"bonnie",
    "phone":"0912345678"
}








