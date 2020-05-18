import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const Mutation = {
  /**
   * Creates a post comment
   *
   * @param {string} comment
   * @param {string} author author id
   * @param {string} postId
   */
  createComment: async (
    root,
    { input: { comment, author, postId } },
    { Comment, Post, User },
  ) => {
    const newComment = await prisma.comment.create({
      data: {
        comment: comment,
        author: {
          connect: {id: parseInt(author)},
        },
        post: {
          connect: {id: parseInt(postId)},
        },
      },
    })

    return newComment
  },
  /**
   * Deletes a post comment
   *
   * @param {string} id
   */
  deleteComment: async (root, { input: { id } }, { Comment, User, Post }) => {
    //Find comment
    const comment = await prisma.comment.delete({
      where: {
        id: parseInt(id),
      },
    })

    return comment
  },
}

export default { Mutation }
