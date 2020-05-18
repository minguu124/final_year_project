import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const Mutation = {
  /**
   * Creates a like for post
   *
   * @param {string} userId
   * @param {string} postId
   */
  createLike: async (
    root,
    { input: { userId, postId } },
    { Like, Post, User },
  ) => {
   
    const like = await prisma.like.create({
      data: {
        user: {
          connect: {id: parseInt(userId)},
        },
        post: {
          connect: {id: parseInt(postId)},
        },
      },
    })

    return like
  },
  /**
   * Deletes a post like
   *
   * @param {string} id
   */
  deleteLike: async (root, { input: { id } }, { Like, User, Post }) => {
    //Find comment
    const like = await prisma.like.delete({
      where: {
        id:  parseInt(id),
      },
    })

    return like
  },
}

export default { Mutation }
