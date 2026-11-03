import { PrismaClient } from '@prisma/client';
import { toProductType } from '../src/utils/productType';
import { tierOf } from '../src/utils/productTier';

const prisma = new PrismaClient();

async function main() {
  const groups = [
    {
      name: 'Usuário',
      products: [
        {
          name: 'Gratuito',
          price: 0,
          type: 'USER',
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
          type: 'USER',
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
          type: 'PHYSICAL_EDUCATOR',
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
          type: 'PHYSICAL_EDUCATOR',
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
      name: 'Academia',
      products: [
        {
          name: 'Plano 1',
          price: 149.9,
          type: 'ACADEMIA',
          productInfos: [
            {
              description:
                'Gerencie educadores físicos e alunos da sua academia',
            },
            { description: 'Convide educadores e recepcionistas por e-mail' },
          ],
        },
        {
          name: 'Plano 2',
          price: 249.9,
          type: 'ACADEMIA',
          productInfos: [
            {
              description:
                'Gerencie educadores físicos e alunos da sua academia',
            },
            { description: 'Convide educadores e recepcionistas por e-mail' },
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
          type: 'NUTRITIONIST',
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
          type: 'NUTRITIONIST',
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
            tier: tierOf(product),
            type: toProductType(product.type),
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
