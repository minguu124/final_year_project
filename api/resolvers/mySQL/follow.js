import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const Mutation = {
    /**
     * Creates a following/follower relationship between users
     *
     * @param {string} userId
     * @param {string} followerId
     */
    createFollow: async (
      root,
      { input: { userId, followerId } },
      { Follow, User }
    ) => {
      const follow = await prisma.follow.create({
          data: {
              user: {
                  connect: {id: parseInt(userId)}
              },
              follower: {
                  connect: {id: parseInt(followerId)}
              }
          }
      })
  
      return follow;
    },
    /**
     * Deletes a following/follower relationship between users
     *
     * @param {string} id follow id
     */
    deleteFollow: async (root, { input: { id } }, { Follow, User }) => {
      
        const follow = prisma.follow.delete({
            where: {
                id: parseInt(id)
            }
        })

      return follow;
    },
  };
  
  export default { Mutation };
  