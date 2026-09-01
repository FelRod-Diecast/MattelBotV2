const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {

  res.send(`
    <html>

      <head>

        <title>MattelBot Dashboard</title>

        <style>

          body {
            background: #111;
            color: white;
            font-family: Arial;
            padding: 20px;
          }

          .card {
            background: #222;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 15px;
          }

        </style>

      </head>

      <body>

        <h1>🚗 MattelBot Dashboard</h1>

        <div class="card">
          Dashboard is running.
        </div>

      </body>

    </html>
  `);

});

app.listen(PORT, () => {

  console.log(
    `Dashboard running on port ${PORT}`
  );

});
