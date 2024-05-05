const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const expressWs = require('express-ws');
// const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const port = process.env.PORT || 3000;

const corsOptions = {
  origin: true, // Permitir todas as origens
};

app.use(bodyParser.json());
app.use(cors(corsOptions)); // Habilitar CORS para a API HTTP

let recursos = [];
let reservas = {}; // Mapa de ID do recurso para ID do cliente que o reservou

// Inicialize o WebSocket no servidor Express
expressWs(app);

//verified token
const verifyToken = async (req, res, next) => {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, 'topSecret', (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    req.userId = decoded.userId;
    next();
  });
};


// Configuração do servidor WebSocket
app.ws('/ws', function (ws, req) {
  console.log('Novo cliente conectado');

  // Enviar lista de recursos para o cliente
  ws.send(JSON.stringify({ type: 'recursos', data: recursos }));

  // Manipular mensagem de reserva de recurso
  ws.on('message', function incoming(message) {
    const data = JSON.parse(message);
    if (data.type === 'reservarRecurso') {
      const id = data.id;
      const recurso = recursos.find(r => r.id === id);
      if (recurso && recurso.disponivel) {
        recurso.disponivel = false;
        reservas[id] = ws.id; // Armazenar reserva associada ao ID do cliente
        // Enviar atualização para todos os clientes
        app.getWss().clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'recursos', data: recursos }));
          }
        });
      }
    } else if (data.type === 'devolverRecurso') {
      const id = data.id;
      const recurso = recursos.find(r => r.id === id);
      if (recurso && !recurso.disponivel && reservas[id] === ws.id) { // Verificar se o cliente atual reservou este recurso
        recurso.disponivel = true;
        delete reservas[id]; // Remover reserva associada ao ID do cliente
        // Enviar atualização para todos os clientes
        app.getWss().clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'recursos', data: recursos }));
          }
        });
      }
    }
  });
});

// Rotas/EndPoints da API HTTP

app.get("/", async (req, res) => {
  res.status(201).send("Welcome to API!");
});


app.post("/login", async (req, res) => {
  try {
    // Retrieve name and password from request body
    const { nome, password } = req.body;

    // Check if name and password are provided
    if (!nome || !password) {
      return res.status(400).json({ error: "Name and password are required" });
    }

    // Use Prisma Client to find the user based on the provided name
    const user = await prisma.clientes.findUnique({
      where: {
        nome: nome,
      },
      select: {
        id: true,
        nome: true,
        password: true // Select the password hash field
      }
    });

    // Check if user exists
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Compare the provided password with the stored password hash
    if (password !== user.password) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, userName: user.nome }, 'topSecret', { expiresIn: '1h' });

    // Authentication successful, return the user ID and token
    res.json({ message: "Authentication successful", userId: user.id, userName: user.nome, token: token });
  } catch (error) {
    console.error("Error during authentication:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete('/users/:id', async (req, res) => {
  const id = req.params.id;

  try {
      // Use Prisma Client to delete the user
      const deletedUser = await prisma.clientes.delete({
          where: {
              id
          },
      });

      res.json({ message: 'User deleted successfully', user: deletedUser });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


// List all resources

app.get('/recursos', verifyToken, async (req, res) => {
  try {
    const recursos = await prisma.recursos.findMany({
      select: {
        id: true,
        nome: true,
        disponivel: true
      }
    });
    res.json(recursos);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching resources' });
  }
});

app.post('/CriarRecursos', async (req, res) => {
  const { nome } = req.body;

  try {
    // Use Prisma Client to create a new resource
    const novoRecurso = await prisma.recursos.create({
      data: {
        nome,
        disponivel: true,
        // reservaId: null,
        // Associate the resource with the user who created it using the userId obtained from the token
        clienteId: req.userId
      }
    });
    
    res.json({ message: 'Resource created successfully', resource: novoRecurso });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error creating resource' });
  }
});


app.post('/CriarCliente', async (req, res) => {
  const { nome,password } = req.body;

  try {
    // Check if the client already exists
    const existingClient = await prisma.clientes.findFirst({
      where: {
        nome,
        password
      },
    });

    if (existingClient) {
      return res.status(409).json({ error: 'Cliente já existe' });
    }

    // Create a new client
    const novoCliente = await prisma.clientes.create({
      data: {
        nome,
        password
      },
    });

    // Send success response
    res.status(201).json({ message: `${nome} adicionado como cliente com sucesso!`, cliente: novoCliente });
  } catch (error) {
    console.error('Erro ao adicionar cliente:', error);
    res.status(500).json({ error: 'Erro ao adicionar cliente' });
  }
});


app.post('/recursos/:id/reservar', verifyToken, async (req, res) => {
  const resourceId = req.params.id;
  const userId = req.userId;

  try {
    // Check if the resource exists
    const resource = await prisma.recursos.findUnique({
      where: {
        id: resourceId,
      },
    });

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Check if the resource is already reserved
    if (resource.disponivel === false) {
      return res.status(400).json({ error: 'Resource is already reserved' });
    }

    // Update the resource to mark it as reserved
    const updatedResource = await prisma.recursos.update({
      where: {
        id: resourceId,
      },
      data: {
        disponivel: false,
        reservaId: userId,
      },
    });

    res.json({ message: 'Resource reserved successfully', resource: updatedResource });
  } catch (error) {
    console.error('Error reserving resource:', error);
    res.status(500).json({ error: 'Error reserving resource' });
  }
});

app.put('/recursos/:id/devolver', async (req, res) => {
  const id = (req.params.id);
  const clienteNome = req.headers['x-client-name'];

  try {
    // Find client by name
    const cliente = await prisma.clientes.findFirst({
      where: {
        nome: clienteNome,
      },
    });

    if (!cliente) {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }

    // Check if the resource is reserved by the client
    const reservedResource = await prisma.recursos.findFirst({
      where: {
        id,
        disponivel: false,
        reservaId: cliente.id,
      },
    });

    if (!reservedResource) {
      return res.status(400).json({ message: 'Recurso não encontrado ou não reservado por este cliente' });
    }

    // Update resource to mark it as available
    await prisma.recursos.update({
      where: { id },
      data: {
        disponivel: true,
        reservaId: null,
      },
    });

    res.json({ message: `Recurso com ID ${id} devolvido com sucesso!` });
  } catch (error) {
    // Handle errors
    res.status(500).json({ error: 'Erro ao devolver recurso' });
  }
});


// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});

