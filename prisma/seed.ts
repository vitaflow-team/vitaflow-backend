import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const groups = [
    {
      name: 'Usuário',
      products: [
        {
          name: 'Gratuito',
          price: 0,
          stripeId: null,
          productInfos: [
            {
              description:
                'Visualização de treinos e cardápios enviados pelos profissionais',
            },
            { description: 'Registro de medidas básicas (peso, altura, IMC)' },
            { description: 'Gráficos simples de evolução' },
            { description: 'Notificações sobre treinos e dieta' },
          ],
        },
        {
          name: 'Premium',
          price: 19.9,
          stripeId: 'prod_Te49KpxtqSQghj',
          productInfos: [
            { description: 'Todas as funcionalidades do plano gratuito' },
            {
              description:
                'Acesso a gráficos detalhados de evolução (antropometria, performance, nutrição)',
            },
            {
              description:
                'Relatórios PDF para compartilhar com médico/nutricionista',
            },
          ],
        },
      ],
    },
    {
      name: 'Educadores físicos',
      products: [
        {
          name: 'Profissional',
          price: 59.9,
          stripeId: 'prod_Te4DmqDejVwQ7g',
          productInfos: [
            { description: 'Cadastro ilimitado de alunos' },
            { description: 'Criação e prescrição de treinos personalizados' },
            {
              description:
                'Registro e acompanhamento de medidas físicas dos alunos',
            },
            { description: 'Agenda para gerenciamento de treinos/sessões' },
            { description: 'Relatórios automáticos de evolução do aluno' },
            { description: 'Integração com planilhas ou exportação de dados' },
          ],
        },
        {
          name: 'Premium',
          price: 99.9,
          stripeId: 'prod_Te4F7Bg79FS5nM',
          productInfos: [
            { description: 'Todas as funcionalidades do plano profissional' },
            {
              description:
                'Gestão financeira: contas a receber, histórico de pagamentos dos alunos',
            },
            {
              description:
                'Gráficos financeiros (receita mensal, inadimplência, projeções)',
            },
            {
              description:
                'Lembretes automáticos para alunos sobre treinos e pagamentos',
            },
          ],
        },
      ],
    },
    {
      name: 'Nutricionistas',
      products: [
        {
          name: 'Profissional',
          price: 79.9,
          stripeId: 'prod_Te4IMbdj8Vy4QF',
          productInfos: [
            { description: 'Cadastro ilimitado de pacientes' },
            { description: 'Criação e prescrição de cardápios personalizados' },
            {
              description:
                'Registro e acompanhamento de medidas nutricionais (peso, circunferências, dobras cutâneas)',
            },
            { description: 'Agenda para consultas presenciais ou online' },
            {
              description: 'Relatórios de evolução nutricional para pacientes',
            },
          ],
        },
        {
          name: 'Premium',
          price: 129.9,
          stripeId: 'prod_Te4KiWwQUkgn5g',
          productInfos: [
            { description: 'Todas as funcionalidades do plano profissional' },
            {
              description:
                'Gestão financeira: contas a receber, histórico de pagamentos dos pacientes',
            },
            {
              description:
                'Gráficos financeiros (receita mensal, inadimplência, projeções)',
            },
            {
              description:
                'Lembretes automáticos de consulta e pagamento para pacientes',
            },
          ],
        },
      ],
    },
  ];

  for (const item of groups) {
    await prisma.productGroup.create({
      data: {
        name: item.name,
        products: {
          create: item.products.map((product) => ({
            name: product.name,
            price: product.price,
            stripeId: product.stripeId,
            productInfos: {
              create: product.productInfos.map((info) => ({
                description: info.description,
              })),
            },
          })),
        },
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
