-- CreateTable
CREATE TABLE "Clientes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "password" TEXT NOT NULL,

    CONSTRAINT "Clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recursos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "reservaId" TEXT,
    "clienteId" TEXT,

    CONSTRAINT "Recursos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clientes_nome_key" ON "Clientes"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Recursos_reservaId_key" ON "Recursos"("reservaId");

-- AddForeignKey
ALTER TABLE "Recursos" ADD CONSTRAINT "Recursos_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
